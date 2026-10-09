import uuid

from arq import ArqRedis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_arq_redis, get_current_company_member, get_db, require_role
from app.models.company_member import CompanyMember
from app.models.invoice import Invoice
from app.schemas.invoice import InvoiceCreate, InvoiceRead, InvoiceUpdate
from app.services.storage import save_file

router = APIRouter(prefix="/companies/{company_id}/invoices", tags=["invoices"])


@router.post("", response_model=InvoiceRead, status_code=201)
async def create_invoice(
    company_id: uuid.UUID,
    payload: InvoiceCreate,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    invoice = Invoice(company_id=company_id, **payload.model_dump())
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.get("", response_model=list[InvoiceRead])
async def list_invoices(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Invoice).where(Invoice.company_id == company_id))
    return result.scalars().all()


@router.post("/upload", response_model=InvoiceRead, status_code=201)
async def upload_invoice(
    company_id: uuid.UUID,
    file: UploadFile = File(...),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
):
    file_reference = await save_file(file, company_id)

    invoice = Invoice(
        company_id=company_id,
        file_reference=file_reference,
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)

    await redis.enqueue_job("extract_invoice", str(invoice.id))

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


@router.patch("/{invoice_id}", response_model=InvoiceRead)
async def update_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
):
    result = await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id, Invoice.company_id == company_id
        )
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(invoice, field, value)

    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}", status_code=204)
async def delete_invoice(
    invoice_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
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
