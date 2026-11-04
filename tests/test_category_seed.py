from __future__ import annotations

import pytest
from sqlalchemy import func, select

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_seed_categories_is_idempotent() -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category
    from app.scripts.seed_categories import DEFAULT_CATEGORY_NAMES, seed_categories

    await seed_categories()
    await seed_categories()

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(func.count(Category.id)).where(
                Category.company_id.is_(None),
                Category.name.in_(DEFAULT_CATEGORY_NAMES),
            )
        )

    assert result.scalar_one() == len(DEFAULT_CATEGORY_NAMES)
