import asyncio
import logging

from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.models.category import Category, CategoryKind
from app.services.categorization import CATEGORY_RULES

DEFAULT_CATEGORY_KINDS = {
    **{name: CategoryKind.expense for name in set(CATEGORY_RULES.values())},
    "Sales Revenue": CategoryKind.income,
    "Other Income": CategoryKind.income,
    "Repairs & Maintenance": CategoryKind.expense,
    "Insurance": CategoryKind.expense,
    "Taxes & Licenses": CategoryKind.expense,
}
DEFAULT_CATEGORY_NAMES = sorted(DEFAULT_CATEGORY_KINDS)
logger = logging.getLogger(__name__)


async def seed_categories():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Category).where(
                Category.company_id.is_(None),
                Category.name.in_(DEFAULT_CATEGORY_NAMES),
            )
        )
        existing_categories = list(result.scalars())
        existing_names = {category.name for category in existing_categories}
        missing_names = set(DEFAULT_CATEGORY_NAMES) - existing_names
        db.add_all(
            Category(
                company_id=None,
                name=name,
                kind=DEFAULT_CATEGORY_KINDS[name],
            )
            for name in sorted(missing_names)
        )
        for category in existing_categories:
            category.kind = DEFAULT_CATEGORY_KINDS[category.name]
        await db.commit()
    logger.info(
        "Default category seed complete", extra={"inserted_count": len(missing_names)}
    )


if __name__ == "__main__":
    asyncio.run(seed_categories())
