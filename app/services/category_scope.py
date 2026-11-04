from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category, CategoryKind


async def validate_category_scope(
    db: AsyncSession,
    company_id: UUID,
    category_id: UUID,
    expected_kind: CategoryKind | None = None,
) -> Category:
    """Validate tenant scope and optional transaction/category direction."""
    conditions = [
        Category.id == category_id,
        or_(Category.company_id == company_id, Category.company_id.is_(None)),
    ]
    if expected_kind is not None:
        conditions.append(Category.kind == expected_kind)
    result = await db.execute(select(Category).where(*conditions))
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(
            status_code=422,
            detail="Category is unavailable or has an incompatible kind",
        )
    return category
