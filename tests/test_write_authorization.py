from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize(
    ("resource", "payload"),
    [
        (
            "transactions",
            {"date": "2026-01-02", "amount": "-12.50", "description": "Meal"},
        ),
        (
            "invoices",
            {"vendor": "Example", "amount": "12.50", "date": "2026-01-02"},
        ),
        (
            "budgets",
            {"category_id": str(uuid4()), "period": "2026-01", "limit_amount": "100"},
        ),
        ("categories", {"name": "Meals"}),
    ],
)
async def test_viewer_cannot_create_financial_resources(
    async_client: AsyncClient, actor_factory: Any, resource: str, payload: dict
) -> None:
    viewer = await actor_factory("viewer")

    response = await async_client.post(
        f"/api/v1/companies/{viewer.company_id}/{resource}",
        headers=viewer.headers,
        json=payload,
    )

    assert response.status_code == 403


async def test_transaction_rejects_another_company_category(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category

    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    async with AsyncSessionLocal() as session:
        category = Category(company_id=other_owner.company_id, name="Private category")
        session.add(category)
        await session.commit()
        foreign_category_id = category.id

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={
            "date": "2026-01-02",
            "amount": "-12.50",
            "description": "Test expense",
            "category_id": str(foreign_category_id),
        },
    )

    assert response.status_code == 422


async def test_budget_rejects_another_company_category(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category

    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    async with AsyncSessionLocal() as session:
        category = Category(company_id=other_owner.company_id, name="Private category")
        session.add(category)
        await session.commit()
        foreign_category_id = category.id

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/budgets",
        headers=owner.headers,
        json={
            "category_id": str(foreign_category_id),
            "period": "2026-01",
            "limit_amount": "100.00",
        },
    )

    assert response.status_code == 422


async def test_category_parent_must_be_global_or_same_company(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category

    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    async with AsyncSessionLocal() as session:
        category = Category(company_id=other_owner.company_id, name="Private parent")
        session.add(category)
        await session.commit()
        foreign_category_id = category.id

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/categories",
        headers=owner.headers,
        json={"name": "Child", "parent_category_id": str(foreign_category_id)},
    )

    assert response.status_code == 422
