from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category


async def validate_category_scope(
    db: AsyncSession, company_id: UUID, category_id: UUID
) -> None:
    """Reject missing and cross-company categories while allowing global defaults."""
    result = await db.execute(
        select(Category.id).where(
            Category.id == category_id,
            or_(Category.company_id == company_id, Category.company_id.is_(None)),
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=422,
            detail="Category must be a global category or belong to this company",
        )
