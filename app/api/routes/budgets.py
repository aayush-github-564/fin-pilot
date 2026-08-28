import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.budget import Budget
from app.models.company_member import CompanyMember
from app.schemas.budget import BudgetCreate, BudgetRead

router = APIRouter(prefix="/companies/{company_id}/budgets", tags=["budgets"])


@router.post("", response_model=BudgetRead, status_code=201)
async def create_budget(
    company_id: uuid.UUID,
    payload: BudgetCreate,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    budget = Budget(company_id=company_id, **payload.model_dump())
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    return budget


@router.get("", response_model=list[BudgetRead])
async def list_budgets(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Budget).where(Budget.company_id == company_id))
    return result.scalars().all()
