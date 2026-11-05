from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _add_transaction(
    company_id: UUID,
    *,
    transaction_date: date,
    amount: str,
    description: str,
    category_id: UUID | None = None,
    source: str = "manual",
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction, TransactionSource

    async with AsyncSessionLocal() as session:
        session.add(
            Transaction(
                company_id=company_id,
                date=transaction_date,
                amount=Decimal(amount),
                description=description,
                category_id=category_id,
                source=TransactionSource(source),
            )
        )
        await session.commit()


async def test_transaction_list_paginates_and_applies_company_scoped_filters(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=owner.company_id,
            name="Office supplies",
            kind=CategoryKind.expense,
        )
        session.add(category)
        await session.commit()
        category_id = category.id

    await _add_transaction(
        owner.company_id,
        transaction_date=date(2026, 4, 1),
        amount="-50.00",
        description="Coffee shop",
        category_id=category_id,
    )
    await _add_transaction(
        owner.company_id,
        transaction_date=date(2026, 4, 2),
        amount="100.00",
        description="Client payment",
    )
    await _add_transaction(
        owner.company_id,
        transaction_date=date(2026, 4, 3),
        amount="-20.00",
        description="Coffee supplies",
        category_id=category_id,
        source="upload",
    )
    await _add_transaction(
        owner.company_id,
        transaction_date=date(2026, 4, 4),
        amount="-10.00",
        description="Unrelated expense",
    )
    await _add_transaction(
        other_owner.company_id,
        transaction_date=date(2026, 4, 5),
        amount="-999.00",
        description="Other company's transaction",
    )
    url = f"/api/v1/companies/{owner.company_id}/transactions"

    first_page = await async_client.get(
        url, headers=owner.headers, params={"limit": 2}
    )
    second_page = await async_client.get(
        url, headers=owner.headers, params={"limit": 2, "offset": 2}
    )
    filtered = await async_client.get(
        url,
        headers=owner.headers,
        params={
            "start_date": "2026-04-02",
            "end_date": "2026-04-03",
            "category_id": str(category_id),
            "categorization_status": "done",
            "source": "upload",
            "direction": "outflow",
            "search": "Coffee",
        },
    )

    assert first_page.status_code == second_page.status_code == filtered.status_code == 200
    assert first_page.json()["total"] == 4
    assert first_page.json()["has_more"] is True
    assert [item["date"] for item in first_page.json()["items"]] == [
        "2026-04-04",
        "2026-04-03",
    ]
    assert second_page.json()["has_more"] is False
    assert len(second_page.json()["items"]) == 2
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["description"] == "Coffee supplies"


async def test_transaction_list_rejects_reversed_date_range(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        params={"start_date": "2026-04-30", "end_date": "2026-04-01"},
    )
    assert response.status_code == 422
