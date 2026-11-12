import mimetypes
import uuid
from datetime import UTC, datetime

from arq import ArqRedis
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_arq_redis, get_current_company_member, get_db, require_permission
from app.core.permissions import Permission
from app.models.company_member import CompanyMember
from app.models.invoice import Invoice, InvoiceDirection, ProcessingStatus
from app.schemas.invoice import InvoiceCreate, InvoiceRead, InvoiceUpdate
from app.services.storage import resolve_file_path, save_file

router = APIRouter(prefix="/companies/{company_id}/invoices", tags=["invoices"])


@router.post("", response_model=InvoiceRead, status_code=201)
async def create_invoice(
    company_id: uuid.UUID,
    payload: InvoiceCreate,
    membership: CompanyMember = Depends(require_permission(Permission.invoice_upload)),
    db: AsyncSession = Depends(get_db),
):
    invoice = Invoice(company_id=company_id, **payload.model_dump())
    invoice.processing_status = ProcessingStatus.complete
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.get("", response_model=list[InvoiceRead])
async def list_invoices(
    company_id: uuid.UUID,
    skip: int = Query(default=0, ge=0, le=100_000),
    limit: int = Query(default=50, ge=1, le=200),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Invoice)
        .where(Invoice.company_id == company_id)
        .order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/upload", response_model=InvoiceRead, status_code=201)
async def upload_invoice(
    company_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    direction: InvoiceDirection = Form(...),
    member: CompanyMember = Depends(require_permission(Permission.invoice_upload)),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
):
    file_reference = await save_file(file, company_id)

    invoice = Invoice(
        company_id=company_id,
        direction=direction,
        file_reference=file_reference,
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)

    await redis.enqueue_job(
        "extract_invoice", str(invoice.id), request.state.request_id
    )

    return invoice


@router.get("/{invoice_id}", response_model=InvoiceRead)
async def get_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
):
    result = await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id, Invoice.company_id == company_id
        )
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.get("/{invoice_id}/download")
async def download_invoice_file(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
):
    result = await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id, Invoice.company_id == company_id
        )
    )
    invoice = result.scalar_one_or_none()
    if (
        invoice is None
        or not invoice.file_reference
        or not invoice.file_reference.startswith(f"{company_id}/")
    ):
        raise HTTPException(status_code=404, detail="Invoice file not found")
    try:
        file_path = resolve_file_path(invoice.file_reference)
    except (FileNotFoundError, OSError, ValueError):
        raise HTTPException(status_code=404, detail="Invoice file not found") from None
    return FileResponse(
        path=file_path,
        media_type=mimetypes.guess_type(file_path.name)[0]
        or "application/octet-stream",
        filename=f"invoice-{invoice.id}{file_path.suffix.lower()}",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/{invoice_id}/confirm", response_model=InvoiceRead)
async def confirm_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.invoice_review)),
):
    result = await db.execute(
        select(Invoice)
        .where(Invoice.id == invoice_id, Invoice.company_id == company_id)
        .with_for_update()
    )
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.confirmed_at is not None:
        return invoice
    if invoice.processing_status in {
        ProcessingStatus.pending,
        ProcessingStatus.processing,
    }:
        raise HTTPException(
            status_code=409, detail="Invoice extraction is not complete"
        )
    if (
        invoice.direction is None
        or not invoice.vendor
        or not invoice.vendor.strip()
        or invoice.amount is None
        or invoice.date is None
    ):
        raise HTTPException(
            status_code=422,
            detail="Direction, vendor, amount, and date are required before confirmation",
        )
    invoice.confirmed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.patch("/{invoice_id}", response_model=InvoiceRead)
async def update_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.invoice_review)),
):
    result = await db.execute(
        select(Invoice)
        .where(Invoice.id == invoice_id, Invoice.company_id == company_id)
        .with_for_update()
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    changes = payload.model_dump(exclude_unset=True)
    relevant_fields = {"direction", "vendor", "amount", "date"}
    if invoice.confirmed_at is not None and relevant_fields.intersection(changes):
        raise HTTPException(
            status_code=409,
            detail="Confirmed invoice details cannot be changed",
        )
    if "direction" in changes and changes["direction"] is None:
        raise HTTPException(status_code=422, detail="direction cannot be null")
    for field, value in changes.items():
        setattr(invoice, field, value)

    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}", status_code=204)
async def delete_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.invoices_manage)),
):
    result = await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id, Invoice.company_id == company_id
        )
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    await db.delete(invoice)
    await db.commit()
    return None
