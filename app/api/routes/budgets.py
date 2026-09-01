import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db, require_role
from app.models.budget import Budget
from app.models.company_member import CompanyMember
from app.schemas.budget import BudgetCreate, BudgetRead, BudgetUpdate

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


@router.get("/{budget_id}", response_model=BudgetRead)
async def get_budget(
    budget_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
):
    result = await db.execute(
        select(Budget).where(Budget.id == budget_id, Budget.company_id == company_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    return budget


@router.patch("/{budget_id}", response_model=BudgetRead)
async def update_budget(
    budget_id: uuid.UUID,
    company_id: uuid.UUID,
    payload: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
):
    result = await db.execute(
        select(Budget).where(Budget.id == budget_id, Budget.company_id == company_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(budget, field, value)

    await db.commit()
    await db.refresh(budget)
    return budget


@router.delete("/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
):
    result = await db.execute(
        select(Budget).where(Budget.id == budget_id, Budget.company_id == company_id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    await db.delete(budget)
    await db.commit()
    return None
