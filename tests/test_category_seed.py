from __future__ import annotations

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_seed_categories_is_idempotent() -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind
    from app.scripts.seed_categories import DEFAULT_CATEGORY_NAMES, seed_categories

    async with AsyncSessionLocal() as session:
        session.add(
            Category(
                company_id=None,
                name="Sales Revenue",
                kind=CategoryKind.expense,
            )
        )
        await session.commit()

    await seed_categories()
    await seed_categories()

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Category).where(
                Category.company_id.is_(None),
                Category.name.in_(DEFAULT_CATEGORY_NAMES),
            )
        )
        seeded_categories = result.scalars().all()

    assert len(seeded_categories) == len(DEFAULT_CATEGORY_NAMES)
    by_name = {category.name: category.kind for category in seeded_categories}
    assert by_name["Sales Revenue"] == CategoryKind.income
    assert by_name["Other Income"] == CategoryKind.income
    assert by_name["Insurance"] == CategoryKind.expense
