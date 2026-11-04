import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db, require_role
from app.models.category import Category
from app.models.company_member import CompanyMember
from app.models.transaction import Transaction
from app.schemas.category import (
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
)
from app.services.category_scope import validate_category_scope

router = APIRouter(prefix="/companies/{company_id}/categories", tags=["categories"])


@router.post("", response_model=CategoryRead, status_code=201)
async def create_category(
    company_id: uuid.UUID,
    payload: CategoryCreate,
    membership: CompanyMember = Depends(require_role("owner", "accountant")),
    db: AsyncSession = Depends(get_db),
):
    if payload.parent_category_id is not None:
        await validate_category_scope(
            db, company_id, payload.parent_category_id, expected_kind=payload.kind
        )
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
    result = await db.execute(
        select(Category).where(
            or_(Category.company_id == company_id, Category.company_id.is_(None))
        )
    )
    return result.scalars().all()


@router.get("/{category_id}", response_model=CategoryRead)
async def get_category(
    category_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
):
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            or_(Category.company_id == company_id, Category.company_id.is_(None)),
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.patch("/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: uuid.UUID,
    company_id: uuid.UUID,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
):
    result = await db.execute(
        select(Category).where(
            Category.id == category_id, Category.company_id == company_id
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    changes = payload.model_dump(exclude_unset=True)
    if any(field in changes and changes[field] is None for field in ("name", "kind")):
        raise HTTPException(status_code=422, detail="Category name and kind cannot be null")
    parent_id = changes.get("parent_category_id", category.parent_category_id)
    kind = changes.get("kind", category.kind)
    if kind != category.kind:
        mismatched_amount = (
            Transaction.amount < 0 if kind.value == "income" else Transaction.amount > 0
        )
        linked_transaction_id = await db.scalar(
            select(Transaction.id)
            .where(
                Transaction.company_id == company_id,
                or_(
                    Transaction.category_id == category.id,
                    Transaction.suggested_category_id == category.id,
                ),
                mismatched_amount,
            )
            .limit(1)
        )
        if linked_transaction_id is not None:
            raise HTTPException(
                status_code=409,
                detail="Category kind conflicts with linked transaction directions",
            )
        mismatched_child_id = await db.scalar(
            select(Category.id)
            .where(
                Category.parent_category_id == category.id,
                Category.kind != kind,
            )
            .limit(1)
        )
        if mismatched_child_id is not None:
            raise HTTPException(
                status_code=409,
                detail="Category kind conflicts with a child category",
            )
    if parent_id is not None:
        if parent_id == category.id:
            raise HTTPException(
                status_code=422, detail="A category cannot be its own parent"
            )
        await validate_category_scope(
            db, company_id, parent_id, expected_kind=kind
        )

    for field, value in changes.items():
        setattr(category, field, value)

    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: uuid.UUID,
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
):
    result = await db.execute(
        select(Category).where(
            Category.id == category_id, Category.company_id == company_id
        )
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(category)
    await db.commit()
    return None
