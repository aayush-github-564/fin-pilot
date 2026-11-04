import asyncio
import logging

from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.models.category import Category
from app.services.categorization import CATEGORY_RULES

DEFAULT_CATEGORY_NAMES = sorted(set(CATEGORY_RULES.values()))
logger = logging.getLogger(__name__)


async def seed_categories():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Category.name).where(
                Category.company_id.is_(None),
                Category.name.in_(DEFAULT_CATEGORY_NAMES),
            )
        )
        existing_names = set(result.scalars().all())
        missing_names = set(DEFAULT_CATEGORY_NAMES) - existing_names
        db.add_all(
            Category(company_id=None, name=name) for name in sorted(missing_names)
        )
        await db.commit()
    logger.info(
        "Default category seed complete", extra={"inserted_count": len(missing_names)}
    )


if __name__ == "__main__":
    asyncio.run(seed_categories())
