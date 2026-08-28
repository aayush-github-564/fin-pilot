import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.category import Category
from app.models.company_member import CompanyMember
from app.schemas.category import CategoryCreate, CategoryRead

router = APIRouter(prefix="/companies/{company_id}/categories", tags=["categories"])


@router.post("", response_model=CategoryRead, status_code=201)
async def create_category(
    company_id: uuid.UUID,
    payload: CategoryCreate,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    category = Category(company_id=company_id, **payload.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("", response_model=list[CategoryRead])
async def list_categories(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Category).where(Category.company_id == company_id))
    return result.scalars().all()
