import base64
import datetime
import json
import logging
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import anthropic
from arq.connections import RedisSettings
from sqlalchemy import select

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.invoice import Invoice, ProcessingStatus
from app.services.storage import get_file_path

logger = logging.getLogger(__name__)

anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

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


async def extract_invoice(ctx, invoice_id: str):
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
            logger.error(f"extract_invoice: invoice {invoice_id} not found")
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
                    "Invoice extraction completed", extra={"invoice_id": invoice_id}
                )

        except Exception:
            logger.exception(
                "Invoice extraction failed", extra={"invoice_id": invoice_id}
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
                    extra={"invoice_id": invoice_id},
                )


async def sample_task(ctx, message: str):
    logger.info(f"Worker received: {message}")
    return f"processed: {message}"


async def startup(ctx):
    logger.info("Worker starting up")


async def shutdown(ctx):
    logger.info("Worker shutting down")


class WorkerSettings:
    functions = [sample_task, extract_invoice]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
