import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.company_member import CompanyMember
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionCreate, TransactionRead

router = APIRouter(prefix="/companies/{company_id}/transactions", tags=["transactions"])


@router.post("", response_model=TransactionRead, status_code=201)
async def create_transaction(
    company_id: uuid.UUID,
    payload: TransactionCreate,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    transaction = Transaction(company_id=company_id, **payload.model_dump())
    db.add(transaction)
    await db.commit()
    await db.refresh(transaction)
    return transaction


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(Transaction.company_id == company_id)
    )
    return result.scalars().all()
