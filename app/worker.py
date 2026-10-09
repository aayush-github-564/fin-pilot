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
    """Claude is instructed to return raw JSON, but occasionally wraps it in
    markdown code fences anyway. Strip those defensively before parsing."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()
    return json.loads(text)


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

            extracted = _clean_json_response(response.content[0].text)
            invoice.extracted_raw = extracted

            if extracted.get("vendor"):
                invoice.vendor = extracted["vendor"]
            if extracted.get("amount") is not None:
                invoice.amount = Decimal(str(extracted["amount"]))
            if extracted.get("date"):
                invoice.date = (
                    datetime.datetime.strptime(extracted["date"], "%Y-%m-%d")
                    .replace(tzinfo=datetime.UTC)
                    .date()
                )

            invoice.processing_status = ProcessingStatus.complete
            await db.commit()
            logger.info(f"extract_invoice: invoice {invoice_id} completed")

        except Exception:
            logger.exception(f"extract_invoice: failed for invoice {invoice_id}")
            invoice.processing_status = ProcessingStatus.failed
            await db.commit()


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
