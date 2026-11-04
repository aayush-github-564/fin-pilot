import base64
import datetime
import json
import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import anthropic
from arq import Retry, cron
from arq.connections import RedisSettings
from sqlalchemy import func, or_, select, update

from app.core.config import settings
from app.core.db import AsyncSessionLocal, engine
from app.core.logging import configure_logging
from app.models.category import Category, CategoryKind
from app.models.invoice import Invoice, ProcessingStatus
from app.models.transaction import (
    CategorizationSource,
    CategorizationStatus,
    Transaction,
)
from app.services.categorization import category_kind_for_amount
from app.services.llm_categorization import CategorySuggestion, suggest_category
from app.services.storage import get_file_path

logger = logging.getLogger(__name__)

anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
categorization_client = anthropic.AsyncAnthropic(
    api_key=settings.anthropic_api_key,
    max_retries=0,
    timeout=60.0,
)

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


async def sample_task(ctx, message: str):
    logger.info(f"Worker received: {message}")
    return f"processed: {message}"


async def startup(ctx):
    configure_logging()
    logger.info("Worker starting up")


async def shutdown(ctx):
    logger.info("Worker shutting down")
    await categorization_client.close()
    await anthropic_client.close()
    await engine.dispose()


class WorkerSettings:
    functions = [sample_task, extract_invoice, categorize_transaction]
    cron_jobs = [
        cron(
            sweep_pending_categorization,
            minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55},
            second=0,
            run_at_startup=True,
            unique=True,
        )
    ]
    max_tries = settings.categorization_max_tries
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
