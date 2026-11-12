import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_company_member,
    get_current_user,
    get_db,
    require_permission,
)
from app.core.permissions import Permission, ROLE_PERMISSIONS, permissions_for_role
from app.models.company import Company
from app.models.company_member import CompanyMember, CompanyRole
from app.models.user import User
from app.schemas.company import (
    CompanyCreate,
    CompanyMembershipRead,
    CompanyRead,
    CompanyUpdate,
)

router = APIRouter(prefix="/companies", tags=["companies"])


@router.post("", response_model=CompanyRead, status_code=201)
async def create_company(
    payload: CompanyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    company = Company(name=payload.name, currency_code=payload.currency_code)
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


@router.get("", response_model=list[CompanyMembershipRead])
async def list_my_companies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(
            Company.id,
            Company.name,
            Company.currency_code,
            Company.created_at,
            CompanyMember.role,
        )
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == current_user.id)
        .order_by(Company.created_at, Company.id)
    )
    return [
        CompanyMembershipRead(
            company_id=row.id,
            name=row.name,
            currency_code=row.currency_code,
            created_at=row.created_at,
            role=row.role,
            permissions=permissions_for_role(row.role),
        )
        for row in result
    ]


@router.get("/{company_id}/me", response_model=CompanyMembershipRead)
async def get_my_company_membership(
    company_id: UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one()
    return CompanyMembershipRead(
        company_id=company.id,
        name=company.name,
        currency_code=company.currency_code,
        created_at=company.created_at,
        role=membership.role,
        permissions=permissions_for_role(membership.role),
    )


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
    member: CompanyMember = Depends(require_permission(Permission.company_edit)),
):
    result = await db.execute(
        select(Company).where(Company.id == company_id).with_for_update()
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    changes = payload.model_dump(exclude_unset=True)
    if "currency_code" in changes:
        if Permission.company_currency not in ROLE_PERMISSIONS[member.role]:
            raise HTTPException(status_code=403, detail="Only an Owner can change accounting currency")
        new_currency = changes["currency_code"]
        if new_currency is None:
            raise HTTPException(status_code=422, detail="currency_code cannot be null")
        if company.currency_code is not None and new_currency != company.currency_code:
            raise HTTPException(
                status_code=409,
                detail="Company currency cannot be changed after it has been set",
            )
    for field, value in changes.items():
        setattr(company, field, value)

    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.company_delete)),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    await db.delete(company)
    await db.commit()
    return None
