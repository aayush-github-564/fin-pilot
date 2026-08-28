import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.invoice import Invoice
from app.models.company_member import CompanyMember
from app.schemas.invoice import InvoiceCreate, InvoiceRead

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
