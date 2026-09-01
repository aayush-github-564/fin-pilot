import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_company_member,
    get_current_user,
    get_db,
    require_role,
)
from app.models.company import Company
from app.models.company_member import CompanyMember, CompanyRole
from app.models.user import User
from app.schemas.company import (
    CompanyCreate,
    CompanyRead,
    CompanyUpdate,
    MemberInvite,
    MemberOut,
)

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


@router.patch("/{company_id}", response_model=CompanyRead)
async def update_company(
    company_id: UUID,
    payload: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner")),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, value)

    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner")),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    await db.delete(company)
    await db.commit()
    return None


@router.post("/{company_id}/invite", response_model=MemberOut, status_code=201)
async def invite_member(
    company_id: UUID,
    payload: MemberInvite,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner")),
):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="No user found with that email")

    existing = await db.execute(
        select(CompanyMember).where(
            CompanyMember.company_id == company_id,
            CompanyMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409, detail="User is already a member of this company"
        )

    new_member = CompanyMember(
        company_id=company_id, user_id=user.id, role=payload.role
    )
    db.add(new_member)
    await db.commit()
    await db.refresh(new_member)
    return new_member
