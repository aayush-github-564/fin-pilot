import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_current_user, get_db
from app.models.company import Company
from app.models.company_member import CompanyMember, CompanyRole
from app.models.user import User
from app.schemas.company import CompanyRead, CompanyCreate

router = APIRouter(prefix="/companies", tags=["companies"])


@router.post("", response_model=CompanyRead, status_code=201)
async def create_company(
    payload: CompanyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    company = Company(name=payload.name)
    db.add(company)
    await db.flush()  # assigns company.id without committing yet

    membership = CompanyMember(
        user_id=current_user.id,
        company_id=company.id,
        role=CompanyRole.owner,
    )
    db.add(membership)

    await db.commit()
    await db.refresh(company)
    return company


@router.get("", response_model=list[CompanyRead])
async def list_my_companies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Company)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == current_user.id)
    )
    return result.scalars().all()


@router.get("/{company_id}", response_model=CompanyRead)
async def get_company(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    return result.scalar_one()
