import asyncio

from app.core.db import AsyncSessionLocal
from app.models.category import Category
from app.services.categorization import CATEGORY_RULES

DEFAULT_CATEGORY_NAMES = sorted(set(CATEGORY_RULES.values()))


async def seed_categories():
    async with AsyncSessionLocal() as db:
        for name in DEFAULT_CATEGORY_NAMES:
            category = Category(company_id=None, name=name)
            db.add(category)
        await db.commit()
    print(f"Seeded {len(DEFAULT_CATEGORY_NAMES)} default categories.")


if __name__ == "__main__":
    asyncio.run(seed_categories())
