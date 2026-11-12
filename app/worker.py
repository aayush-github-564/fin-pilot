import asyncio
import base64
import datetime
from email.message import EmailMessage
from html import escape
import json
import logging
import smtplib
import ssl
import time
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import anthropic
from arq import Retry, cron
from arq.connections import RedisSettings
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.core.db import AsyncSessionLocal, engine
from app.core.logging import configure_logging
from app.models.category import Category, CategoryKind
from app.models.company import Company
from app.models.company_member import CompanyMember, CompanyRole
from app.models.invoice import Invoice, ProcessingStatus
from app.models.transaction import (
    CategorizationSource,
    CategorizationStatus,
    Transaction,
)
from app.models.user import User
from app.models.weekly_digest import WeeklyDigest, WeeklyDigestDelivery
from app.services.categorization import category_kind_for_amount
from app.services.llm_categorization import CategorySuggestion, suggest_category
from app.services.storage import get_file_path
from app.services.weekly_digest import (
    build_weekly_digest_facts,
    deterministic_digest_summary,
    generate_digest_summary,
    load_digest_recipients,
    previous_full_week,
    render_digest_email,
    send_weekly_digest_email,
    smtp_delivery_configured,
)

logger = logging.getLogger(__name__)

anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
categorization_client = anthropic.AsyncAnthropic(
    api_key=settings.anthropic_api_key,
    max_retries=0,
    timeout=60.0,
)
weekly_digest_client = anthropic.AsyncAnthropic(
    api_key=settings.anthropic_api_key,
    max_retries=0,
    timeout=30.0,
)
WEEKLY_DIGEST_MAX_DELIVERY_ATTEMPTS = 5
WEEKLY_DIGEST_DELIVERY_LEASE = timedelta(minutes=30)
WEEKLY_DIGEST_RETRY_BATCH = 200

EXTENSION_TO_MEDIA_TYPE = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

EXTRACTION_PROMPT = """You are looking at a scanned invoice or receipt.
Extract exactly these three fields and respond with ONLY a JSON object, no other text, no markdown formatting:

{"vendor": "<business/vendor name>", "amount": <total amount as a number, no currency symbol>, "date": "<invoice date in YYYY-MM-DD format>"}

If a field cannot be confidently determined from the image, use null for that field."""


def _clean_json_response(raw_text: str) -> dict:
    """Parse a JSON object, allowing a single optional Markdown code fence."""
    text = raw_text.strip()
    lines = text.splitlines()
    if lines and lines[0].strip().startswith("```"):
        if len(lines) < 3 or lines[-1].strip() != "```":
            raise ValueError("Malformed JSON code fence")
        fence_language = lines[0].strip()[3:].strip().casefold()
        if fence_language not in {"", "json"}:
            raise ValueError("Unexpected code fence language")
        text = "\n".join(lines[1:-1]).strip()

    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Invoice extraction must be a JSON object")
    return parsed


def _parse_invoice_fields(
    extracted: dict,
) -> tuple[str | None, Decimal | None, datetime.date | None]:
    vendor_raw = extracted.get("vendor")
    if vendor_raw is not None and not isinstance(vendor_raw, str):
        raise ValueError("Extracted vendor must be a string or null")
    vendor = (vendor_raw.strip() or None) if vendor_raw is not None else None

    amount_raw = extracted.get("amount")
    if isinstance(amount_raw, bool) or (
        amount_raw is not None and not isinstance(amount_raw, (int, float, Decimal))
    ):
        raise ValueError("Extracted amount must be numeric or null")
    amount = Decimal(str(amount_raw)) if amount_raw is not None else None
    if amount is not None and not amount.is_finite():
        raise ValueError("Extracted amount must be finite")
    if amount is not None:
        cents = amount.quantize(Decimal("0.01"))
        if cents != amount or abs(amount) > Decimal("9999999999.99"):
            raise ValueError(
                "Extracted amount exceeds the supported currency precision"
            )

    date_raw = extracted.get("date")
    if date_raw is not None and not isinstance(date_raw, str):
        raise ValueError("Extracted date must be an ISO date string or null")
    invoice_date = (
        datetime.datetime.strptime(date_raw, "%Y-%m-%d").date()
        if date_raw is not None
        else None
    )
    return vendor, amount, invoice_date


async def extract_invoice(ctx, invoice_id: str, request_id: str | None = None):
    """
    Reads the uploaded file for an invoice, sends it to Claude for
    vision-based field extraction, and updates the Invoice row with
    the results. Claude only transcribes what's visible on the page —
    it never performs arithmetic or acts as the source of truth for numbers.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Invoice).where(Invoice.id == UUID(invoice_id)))
        invoice = result.scalar_one_or_none()

        if invoice is None:
            logger.error(
                "Invoice extraction skipped; invoice not found",
                extra={"invoice_id": invoice_id, "request_id": request_id},
            )
            return

        invoice.processing_status = ProcessingStatus.processing
        await db.commit()

        try:
            file_path = get_file_path(invoice.file_reference)
            extension = Path(file_path).suffix.lower()
            media_type = EXTENSION_TO_MEDIA_TYPE.get(extension)

            if media_type is None:
                raise ValueError(f"Unsupported file type: {extension}")

            file_bytes = file_path.read_bytes()
            encoded = base64.standard_b64encode(file_bytes).decode("utf-8")
            block_type = "document" if media_type == "application/pdf" else "image"

            response = await anthropic_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": block_type,
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": encoded,
                                },
                            },
                            {"type": "text", "text": EXTRACTION_PROMPT},
                        ],
                    }
                ],
            )

            text_blocks = [
                block.text
                for block in response.content
                if getattr(block, "type", None) == "text"
                and isinstance(getattr(block, "text", None), str)
            ]
            if not text_blocks:
                raise ValueError("Extraction model returned no text response")

            extracted = _clean_json_response(text_blocks[0])
            vendor, amount, invoice_date = _parse_invoice_fields(extracted)
            invoice.extracted_raw = extracted

            if vendor is not None:
                invoice.vendor = vendor
            if amount is not None:
                invoice.amount = amount
            if invoice_date is not None:
                invoice.date = invoice_date

            invoice.processing_status = ProcessingStatus.complete
            await db.commit()
            missing_fields = [
                name
                for name, value in (
                    ("vendor", vendor),
                    ("amount", amount),
                    ("date", invoice_date),
                )
                if value is None
            ]
            if missing_fields:
                logger.warning(
                    "Invoice extraction completed with missing fields",
                    extra={"invoice_id": invoice_id, "missing_fields": missing_fields},
                )
            else:
                logger.info(
                    "Invoice extraction completed",
                    extra={"invoice_id": invoice_id, "request_id": request_id},
                )

        except Exception:
            logger.exception(
                "Invoice extraction failed",
                extra={"invoice_id": invoice_id, "request_id": request_id},
            )
            await db.rollback()
            try:
                invoice = await db.get(Invoice, UUID(invoice_id))
                if invoice is not None:
                    invoice.processing_status = ProcessingStatus.failed
                    await db.commit()
            except Exception:
                logger.exception(
                    "Could not persist invoice extraction failure",
                    extra={"invoice_id": invoice_id, "request_id": request_id},
                )


@dataclass(frozen=True)
class _CategorizationInput:
    transaction_id: UUID
    company_id: UUID
    amount: Decimal
    description: str | None
    direction: str
    category_names: list[str]
    category_ids_by_name: dict[str, UUID]
    request_id: str | None


async def _load_categorization_input(
    transaction_id: UUID, request_id: str | None,
) -> _CategorizationInput | None:
    """Read the transaction and its own tenant's category candidates."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == transaction_id)
        )
        transaction = result.scalar_one_or_none()
        if (
            transaction is None
            or transaction.category_id is not None
            or transaction.categorization_status != CategorizationStatus.pending
        ):
            return None

        amount = Decimal(transaction.amount)
        category_kind = category_kind_for_amount(amount)
        if category_kind is None:
            return _CategorizationInput(
                transaction_id=transaction.id,
                company_id=transaction.company_id,
                amount=amount,
                description=transaction.description,
                direction="neutral",
                category_names=[],
                category_ids_by_name={},
                request_id=request_id,
            )

        result = await db.execute(
            select(Category).where(
                Category.kind == category_kind,
                or_(
                    Category.company_id == transaction.company_id,
                    Category.company_id.is_(None),
                ),
            )
        )
        categories = sorted(
            result.scalars().all(),
            key=lambda category: (
                category.name.casefold(),
                category.company_id != transaction.company_id,
                str(category.id),
            ),
        )
        category_ids_by_name: dict[str, UUID] = {}
        for category in categories:
            category_ids_by_name.setdefault(category.name, category.id)

        return _CategorizationInput(
            transaction_id=transaction.id,
            company_id=transaction.company_id,
            amount=amount,
            description=transaction.description,
            direction="inflow" if category_kind == CategoryKind.income else "outflow",
            category_names=list(category_ids_by_name),
            category_ids_by_name=category_ids_by_name,
            request_id=request_id,
        )


async def _conditional_categorization_update(
    transaction_id: UUID,
    company_id: UUID,
    *,
    status: CategorizationStatus,
    category_id: UUID | None = None,
    categorization_source: CategorizationSource | None = None,
    suggested_category_id: UUID | None = None,
    suggestion_confidence: Decimal | None = None,
) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(Transaction)
            .where(
                Transaction.id == transaction_id,
                Transaction.company_id == company_id,
                Transaction.category_id.is_(None),
                Transaction.categorization_status == CategorizationStatus.pending,
            )
            .values(
                category_id=category_id,
                categorization_status=status,
                categorization_source=categorization_source,
                suggested_category_id=suggested_category_id,
                suggestion_confidence=suggestion_confidence,
            )
        )
        await db.commit()
        return result.rowcount == 1


def _log_categorization(
    job_input: _CategorizationInput,
    *,
    outcome: str,
    attempt: int,
    latency_ms: float,
    suggestion: CategorySuggestion | None = None,
) -> None:
    logger.info(
        "Transaction categorization job finished",
        extra={
            "transaction_id": str(job_input.transaction_id),
            "company_id": str(job_input.company_id),
            "request_id": job_input.request_id,
            "outcome": outcome,
            "confidence": suggestion.confidence if suggestion else None,
            "model": settings.categorization_model,
            "latency_ms": round(latency_ms, 2),
            "input_tokens": suggestion.input_tokens if suggestion else None,
            "output_tokens": suggestion.output_tokens if suggestion else None,
            "attempt": attempt,
        },
    )


def _is_transient_anthropic_error(error: Exception) -> bool:
    if isinstance(
        error,
        (anthropic.APIConnectionError, anthropic.APITimeoutError, anthropic.RateLimitError),
    ):
        return True
    return isinstance(error, anthropic.APIStatusError) and (
        error.status_code == 408 or error.status_code >= 500
    )


async def categorize_transaction(
    ctx, transaction_id: str, request_id: str | None = None
) -> None:
    """Run one constrained categorization attempt, then conditionally persist it."""
    tx_id = UUID(transaction_id)
    attempt = int(ctx.get("job_try", 1))
    started_at = time.perf_counter()
    job_input = await _load_categorization_input(tx_id, request_id)
    if job_input is None:
        logger.info(
            "Transaction categorization skipped",
            extra={
                "transaction_id": str(tx_id),
                "request_id": request_id,
                "outcome": "superseded_or_missing",
            },
        )
        return

    if job_input.direction == "neutral":
        updated = await _conditional_categorization_update(
            tx_id, job_input.company_id, status=CategorizationStatus.needs_review
        )
        _log_categorization(
            job_input,
            outcome="needs_review" if updated else "superseded",
            attempt=attempt,
            latency_ms=(time.perf_counter() - started_at) * 1000,
        )
        return

    if not job_input.category_names:
        updated = await _conditional_categorization_update(
            tx_id, job_input.company_id, status=CategorizationStatus.needs_review
        )
        _log_categorization(
            job_input,
            outcome="no_allowed_categories" if updated else "superseded",
            attempt=attempt,
            latency_ms=(time.perf_counter() - started_at) * 1000,
        )
        return

    suggestion: CategorySuggestion | None = None
    try:
        suggestion = await suggest_category(
            categorization_client,
            model=settings.categorization_model,
            description=job_input.description,
            direction=job_input.direction,
            absolute_amount=abs(job_input.amount),
            allowed_category_names=job_input.category_names,
        )
    except Exception as error:
        if _is_transient_anthropic_error(error):
            if attempt < settings.categorization_max_tries:
                logger.warning(
                    "Transient transaction categorization error; retry scheduled",
                    extra={
                        "transaction_id": str(tx_id),
                        "company_id": str(job_input.company_id),
                        "request_id": request_id,
                        "attempt": attempt,
                        "error_type": type(error).__name__,
                    },
                )
                raise Retry(defer=min(30, 2 ** (attempt - 1))) from error

            updated = await _conditional_categorization_update(
                tx_id, job_input.company_id, status=CategorizationStatus.failed
            )
            _log_categorization(
                job_input,
                outcome="failed" if updated else "superseded",
                attempt=attempt,
                latency_ms=(time.perf_counter() - started_at) * 1000,
            )
            return

        logger.error(
            "Transaction categorization request failed",
            extra={
                "transaction_id": str(tx_id),
                "company_id": str(job_input.company_id),
                "request_id": request_id,
                "error_type": type(error).__name__,
                "attempt": attempt,
            },
        )
        updated = await _conditional_categorization_update(
            tx_id, job_input.company_id, status=CategorizationStatus.failed
        )
        _log_categorization(
            job_input,
            outcome="failed" if updated else "superseded",
            attempt=attempt,
            latency_ms=(time.perf_counter() - started_at) * 1000,
        )
        return

    category_id = (
        job_input.category_ids_by_name.get(suggestion.category)
        if suggestion.valid and suggestion.category is not None
        else None
    )
    confidence = (
        Decimal(str(suggestion.confidence)).quantize(Decimal("0.01"))
        if suggestion.valid and category_id is not None and suggestion.confidence is not None
        else None
    )
    if not suggestion.valid:
        status = CategorizationStatus.needs_review
        categorization_source = None
        outcome = "invalid_response"
    elif category_id is not None and suggestion.confidence is not None:
        if suggestion.confidence >= settings.categorization_confidence_threshold:
            status = CategorizationStatus.done
            categorization_source = CategorizationSource.llm_auto
            outcome = "auto_applied"
        else:
            status = CategorizationStatus.needs_review
            categorization_source = None
            outcome = "needs_review"
    else:
        status = CategorizationStatus.needs_review
        categorization_source = None
        outcome = "needs_review"

    applied_category_id = category_id if status == CategorizationStatus.done else None
    updated = await _conditional_categorization_update(
        tx_id,
        job_input.company_id,
        status=status,
        category_id=applied_category_id,
        categorization_source=categorization_source,
        suggested_category_id=category_id,
        suggestion_confidence=confidence,
    )
    _log_categorization(
        job_input,
        outcome=outcome if updated else "superseded",
        attempt=attempt,
        latency_ms=(time.perf_counter() - started_at) * 1000,
        suggestion=suggestion,
    )


async def sweep_pending_categorization(ctx) -> int:
    """Re-enqueue old pending rows left behind by queue outages or deployments."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction.id)
            .where(
                Transaction.categorization_status == CategorizationStatus.pending,
                Transaction.category_id.is_(None),
                Transaction.created_at < func.now() - timedelta(minutes=5),
            )
            .order_by(Transaction.created_at, Transaction.id)
            .limit(100)
        )
        transaction_ids = result.scalars().all()

    redis = ctx["redis"]
    enqueued_count = 0
    duplicate_count = 0
    for transaction_id in transaction_ids:
        try:
            job = await redis.enqueue_job(
                "categorize_transaction",
                str(transaction_id),
                _job_id=f"categorize:{transaction_id}",
            )
            if job is None:
                duplicate_count += 1
            else:
                enqueued_count += 1
        except Exception as error:
            logger.error(
                "Could not re-enqueue pending transaction categorization",
                extra={
                    "transaction_id": str(transaction_id),
                    "error_type": type(error).__name__,
                },
            )

    logger.info(
        "Pending categorization sweep complete",
        extra={
            "found_count": len(transaction_ids),
            "enqueue_count": enqueued_count,
            "duplicate_count": duplicate_count,
        },
    )
    return enqueued_count


async def schedule_weekly_digests(ctx) -> int:
    """Queue the prior complete UTC week once for every company with recipients."""
    period_start, period_end = previous_full_week()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(CompanyMember.company_id)
            .where(
                CompanyMember.role.in_([CompanyRole.owner, CompanyRole.accountant])
            )
            .distinct()
            .order_by(CompanyMember.company_id)
        )
        company_ids = result.scalars().all()

    redis = ctx["redis"]
    enqueued = 0
    duplicate = 0
    failed = 0
    for company_id in company_ids:
        try:
            job = await redis.enqueue_job(
                "generate_weekly_digest",
                str(company_id),
                period_start.isoformat(),
                _job_id=f"weekly-digest:{company_id}:{period_start.isoformat()}",
            )
            if job is None:
                duplicate += 1
            else:
                enqueued += 1
        except Exception as error:
            failed += 1
            logger.error(
                "Could not queue weekly digest",
                extra={
                    "company_id": str(company_id),
                    "period_start": period_start.isoformat(),
                    "error_type": type(error).__name__,
                },
            )
    logger.info(
        "Weekly digest scheduling complete",
        extra={
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "company_count": len(company_ids),
            "enqueued_count": enqueued,
            "duplicate_count": duplicate,
            "failed_count": failed,
        },
    )
    return enqueued


async def generate_weekly_digest(ctx, company_id: str, period_start: str) -> str | None:
    """Compute and persist one idempotent company/week digest, then queue deliveries."""
    company_uuid = UUID(company_id)
    week_start = datetime.date.fromisoformat(period_start)
    if week_start.weekday() != 0:
        raise ValueError("period_start must be a Monday")
    week_end = week_start + timedelta(days=6)

    async with AsyncSessionLocal() as db:
        existing_result = await db.execute(
            select(WeeklyDigest).where(
                WeeklyDigest.company_id == company_uuid,
                WeeklyDigest.period_start == week_start,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            digest_id = existing.id
        else:
            company_result = await db.execute(
                select(Company).where(Company.id == company_uuid)
            )
            company = company_result.scalar_one_or_none()
            if company is None:
                logger.warning(
                    "Weekly digest skipped because company was not found",
                    extra={"company_id": company_id, "period_start": period_start},
                )
                return None

            facts = await build_weekly_digest_facts(
                db, company_id=company_uuid, period_start=week_start
            )
            recipients = await load_digest_recipients(db, company_id=company_uuid)
            await db.commit()
            client = ctx.get("weekly_digest_client", weekly_digest_client)
            summary: str | None = None
            try:
                summary = await generate_digest_summary(
                    client, model=settings.weekly_digest_model, facts=facts
                )
            except Exception as error:
                logger.warning(
                    "Weekly digest summary model failed; using deterministic summary",
                    extra={
                        "company_id": company_id,
                        "period_start": period_start,
                        "error_type": type(error).__name__,
                    },
                )
            summary_source = "llm" if summary else "deterministic"
            summary = summary or deterministic_digest_summary(facts)
            digest_candidate_id = uuid4()
            inserted = await db.execute(
                pg_insert(WeeklyDigest)
                .values(
                    id=digest_candidate_id,
                    company_id=company_uuid,
                    period_start=week_start,
                    period_end=week_end,
                    facts=facts,
                    summary=summary,
                    summary_source=summary_source,
                )
                .on_conflict_do_nothing(
                    index_elements=[WeeklyDigest.company_id, WeeklyDigest.period_start]
                )
                .returning(WeeklyDigest.id)
            )
            digest_id = inserted.scalar_one_or_none()
            if digest_id is not None:
                initial_status = "pending" if smtp_delivery_configured() else "not_configured"
                db.add_all(
                    [
                        WeeklyDigestDelivery(
                            digest_id=digest_id,
                            user_id=user_id,
                            email_address=email,
                            status=initial_status,
                        )
                        for user_id, email in recipients
                    ]
                )
            else:
                # Another worker won the company/week uniqueness race; reuse its row.
                await db.flush()
                conflict_result = await db.execute(
                    select(WeeklyDigest.id).where(
                        WeeklyDigest.company_id == company_uuid,
                        WeeklyDigest.period_start == week_start,
                    )
                )
                digest_id = conflict_result.scalar_one_or_none()
            await db.commit()
            if digest_id is None:
                logger.error(
                    "Weekly digest could not be persisted",
                    extra={"company_id": company_id, "period_start": period_start},
                )
                return None

    if smtp_delivery_configured():
        async with AsyncSessionLocal() as db:
            # A digest made while SMTP was unavailable can be delivered after setup.
            await db.execute(
                update(WeeklyDigestDelivery)
                .where(
                    WeeklyDigestDelivery.digest_id == digest_id,
                    WeeklyDigestDelivery.status == "not_configured",
                )
                .values(status="pending", updated_at=func.now())
            )
            await db.commit()
            result = await db.execute(
                select(WeeklyDigestDelivery.id, WeeklyDigestDelivery.attempt_count)
                .where(
                    WeeklyDigestDelivery.digest_id == digest_id,
                    WeeklyDigestDelivery.status.in_(["pending", "failed"]),
                    WeeklyDigestDelivery.attempt_count
                    < WEEKLY_DIGEST_MAX_DELIVERY_ATTEMPTS,
                )
                .order_by(WeeklyDigestDelivery.id)
            )
            delivery_rows = list(result)
        redis = ctx["redis"]
        for delivery_id, attempt_count in delivery_rows:
            try:
                await redis.enqueue_job(
                    "deliver_weekly_digest",
                    str(delivery_id),
                    _job_id=f"weekly-digest-delivery:{delivery_id}:{attempt_count}",
                )
            except Exception as error:
                logger.error(
                    "Could not queue weekly digest delivery",
                    extra={
                        "digest_id": str(digest_id),
                        "delivery_id": str(delivery_id),
                        "error_type": type(error).__name__,
                    },
                )
    logger.info(
        "Weekly digest generated",
        extra={
            "digest_id": str(digest_id),
            "company_id": company_id,
            "period_start": period_start,
            "period_end": week_end.isoformat(),
        },
    )
    return str(digest_id)


async def deliver_weekly_digest(ctx, delivery_id: str) -> None:
    """Claim one outbox row, send privately, and record success or retryable failure."""
    delivery_uuid = UUID(delivery_id)
    now = datetime.datetime.now(datetime.timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WeeklyDigestDelivery)
            .where(WeeklyDigestDelivery.id == delivery_uuid)
            .with_for_update()
        )
        delivery = result.scalar_one_or_none()
        if delivery is None or delivery.status == "sent":
            return
        if delivery.attempt_count >= WEEKLY_DIGEST_MAX_DELIVERY_ATTEMPTS:
            return
        if delivery.status == "sending" and delivery.updated_at > now - WEEKLY_DIGEST_DELIVERY_LEASE:
            return
        if not smtp_delivery_configured():
            delivery.status = "not_configured"
            delivery.updated_at = now
            await db.commit()
            return
        digest_result = await db.execute(
            select(WeeklyDigest).where(WeeklyDigest.id == delivery.digest_id)
        )
        digest = digest_result.scalar_one_or_none()
        company_result = await db.execute(
            select(Company.name).where(Company.id == digest.company_id)
        ) if digest is not None else None
        if digest is None or company_result is None:
            delivery.status = "failed"
            delivery.last_error_code = "digest_missing"
            delivery.updated_at = now
            await db.commit()
            return
        company_name = company_result.scalar_one_or_none() or "your company"
        membership_result = await db.execute(
            select(CompanyMember.id).where(
                CompanyMember.company_id == digest.company_id,
                CompanyMember.user_id == delivery.user_id,
                CompanyMember.role.in_([CompanyRole.owner, CompanyRole.accountant]),
            )
        )
        if membership_result.scalar_one_or_none() is None:
            await db.delete(delivery)
            await db.commit()
            logger.info(
                "Weekly digest delivery skipped after recipient role change",
                extra={
                    "delivery_id": delivery_id,
                    "digest_id": str(digest.id),
                    "company_id": str(digest.company_id),
                    "user_id": str(delivery.user_id),
                },
            )
            return
        email_result = await db.execute(
            select(User.email).where(User.id == delivery.user_id)
        )
        current_email = email_result.scalar_one_or_none()
        if current_email is None:
            await db.delete(delivery)
            await db.commit()
            return
        delivery.email_address = current_email
        delivery.status = "sending"
        delivery.attempt_count += 1
        delivery.last_error_code = None
        delivery.updated_at = now
        period_start = digest.period_start
        period_end = digest.period_end
        body = render_digest_email(
            company_name=company_name,
            period_start=period_start,
            period_end=period_end,
            summary=digest.summary,
            facts=digest.facts,
        )
        recipient = delivery.email_address
        subject_company = " ".join(company_name.split())[:100]
        subject = (
            f"FinPilot weekly finance digest — {subject_company} — "
            f"{period_start.isoformat()} to {period_end.isoformat()}"
        )
        await db.commit()

    sender = ctx.get("send_weekly_digest_email", send_weekly_digest_email)
    try:
        await sender(recipient=recipient, subject=subject, body=body)
    except Exception as error:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(WeeklyDigestDelivery)
                .where(WeeklyDigestDelivery.id == delivery_uuid)
                .values(
                    status="failed",
                    last_error_code=type(error).__name__[:50],
                    updated_at=func.now(),
                )
            )
            await db.commit()
        logger.error(
            "Weekly digest email delivery failed",
            extra={
                "delivery_id": delivery_id,
                "digest_id": str(delivery.digest_id),
                "user_id": str(delivery.user_id),
                "attempt_count": delivery.attempt_count,
                "error_type": type(error).__name__,
            },
        )
        return

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(WeeklyDigestDelivery)
            .where(WeeklyDigestDelivery.id == delivery_uuid)
            .values(
                status="sent",
                sent_at=func.now(),
                updated_at=func.now(),
                last_error_code=None,
            )
        )
        await db.commit()
    logger.info(
        "Weekly digest email delivered",
        extra={
            "delivery_id": delivery_id,
            "digest_id": str(delivery.digest_id),
            "company_id": str(digest.company_id),
            "user_id": str(delivery.user_id),
            "period_start": period_start.isoformat(),
            "attempt_count": delivery.attempt_count,
        },
    )


async def sweep_weekly_digest_deliveries(ctx) -> int:
    """Requeue pending or retryable per-recipient outbox rows."""
    if not smtp_delivery_configured():
        return 0
    now = datetime.datetime.now(datetime.timezone.utc)
    stale_before = now - WEEKLY_DIGEST_DELIVERY_LEASE
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WeeklyDigestDelivery.id, WeeklyDigestDelivery.attempt_count)
            .join(WeeklyDigest, WeeklyDigest.id == WeeklyDigestDelivery.digest_id)
            .where(
                WeeklyDigestDelivery.attempt_count
                < WEEKLY_DIGEST_MAX_DELIVERY_ATTEMPTS,
                WeeklyDigest.period_start >= now.date() - timedelta(days=60),
                or_(
                    WeeklyDigestDelivery.status.in_(
                        ["pending", "failed", "not_configured"]
                    ),
                    and_(
                        WeeklyDigestDelivery.status == "sending",
                        WeeklyDigestDelivery.updated_at < stale_before,
                    ),
                ),
            )
            .order_by(WeeklyDigestDelivery.updated_at, WeeklyDigestDelivery.id)
            .limit(WEEKLY_DIGEST_RETRY_BATCH)
        )
        deliveries = list(result)
    redis = ctx["redis"]
    enqueued = 0
    for delivery_id, attempt_count in deliveries:
        try:
            job = await redis.enqueue_job(
                "deliver_weekly_digest",
                str(delivery_id),
                _job_id=f"weekly-digest-delivery:{delivery_id}:{attempt_count}",
            )
            enqueued += int(job is not None)
        except Exception as error:
            logger.error(
                "Could not requeue weekly digest email",
                extra={
                    "delivery_id": str(delivery_id),
                    "error_type": type(error).__name__,
                },
            )
    logger.info(
        "Weekly digest delivery sweep complete",
        extra={"found_count": len(deliveries), "enqueue_count": enqueued},
    )
    return enqueued


async def sample_task(ctx, message: str):
    logger.info(f"Worker received: {message}")
    return f"processed: {message}"


async def send_company_invitation(
    ctx,
    email: str,
    company_name: str,
    role: str,
    inviter_name: str,
    invite_url: str,
) -> None:
    """Send a company invitation from the worker, never in the API request."""
    if not (settings.smtp_host and settings.smtp_from):
        logger.info("Invitation email skipped because SMTP is not configured")
        return

    safe_company = escape(company_name)
    safe_inviter = escape(inviter_name)
    safe_role = escape(role.title())
    safe_url = escape(invite_url, quote=True)
    message = EmailMessage()
    message["Subject"] = f"{inviter_name} invited you to {company_name} on FinPilot"
    message["From"] = str(settings.smtp_from)
    message["To"] = email
    message.set_content(
        f"{inviter_name} invited you to join {company_name} as {role.title()}.\n\n"
        f"Accept the invitation: {invite_url}\n\n"
        "This invitation expires in seven days. If you were not expecting it, you can ignore this email."
    )
    message.add_alternative(
        "<!doctype html><html><body><main style='font-family:Arial,sans-serif;max-width:560px;margin:auto'>"
        f"<p>{safe_inviter} invited you to join <strong>{safe_company}</strong> as {safe_role}.</p>"
        f"<p><a href='{safe_url}'>Accept invitation</a></p>"
        "<p>This invitation expires in seven days. If you were not expecting it, you can ignore this email.</p>"
        "</main></body></html>",
        subtype="html",
    )

    def send() -> None:
        if settings.smtp_port == 465:
            client = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=20,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
        with client:
            if settings.smtp_port != 465:
                client.starttls(context=ssl.create_default_context())
            if settings.smtp_user and settings.smtp_password:
                client.login(settings.smtp_user, settings.smtp_password.get_secret_value())
            client.send_message(message)

    await asyncio.to_thread(send)
    logger.info("Company invitation email sent", extra={"recipient_domain": email.rsplit("@", 1)[-1]})


async def startup(ctx):
    configure_logging()
    logger.info("Worker starting up")


async def shutdown(ctx):
    logger.info("Worker shutting down")
    await categorization_client.close()
    await anthropic_client.close()
    await weekly_digest_client.close()
    await engine.dispose()


class WorkerSettings:
    functions = [
        sample_task,
        extract_invoice,
        categorize_transaction,
        generate_weekly_digest,
        deliver_weekly_digest,
        send_company_invitation,
    ]
    cron_jobs = [
        cron(
            sweep_pending_categorization,
            minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55},
            second=0,
            run_at_startup=True,
            unique=True,
        ),
        cron(
            schedule_weekly_digests,
            weekday={0},
            hour={8},
            minute={0},
            second=0,
            run_at_startup=False,
            unique=True,
        ),
        cron(
            sweep_weekly_digest_deliveries,
            hour={0, 6, 12, 18},
            minute={0},
            second=0,
            run_at_startup=False,
            unique=True,
        ),
    ]
    max_tries = settings.categorization_max_tries
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
