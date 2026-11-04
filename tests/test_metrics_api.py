from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _add_transaction(
    company_id: UUID,
    transaction_date: date,
    amount: str,
    category_id: UUID | None = None,
) -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction, TransactionSource

    async with AsyncSessionLocal() as session:
        transaction = Transaction(
            company_id=company_id,
            date=transaction_date,
            amount=Decimal(amount),
            description="Metric fixture",
            category_id=category_id,
            source=TransactionSource.manual,
        )
        session.add(transaction)
        await session.commit()
        return transaction.id


async def _add_category(
    company_id: UUID | None,
    name: str,
    kind: str = "expense",
) -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(company_id=company_id, name=name, kind=CategoryKind(kind))
        session.add(category)
        await session.commit()
        return category.id


async def _add_budget(
    company_id: UUID,
    category_id: UUID,
    period: str,
    amount: str,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Budget

    async with AsyncSessionLocal() as session:
        session.add(
            Budget(
                company_id=company_id,
                category_id=category_id,
                period=period,
                limit_amount=Decimal(amount),
            )
        )
        await session.commit()


async def test_cash_flow_metrics_are_inclusive_bucketed_and_company_scoped(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    await _add_transaction(owner.company_id, date(2026, 1, 1), "1000.00")
    await _add_transaction(owner.company_id, date(2026, 1, 31), "-1200.00")
    await _add_transaction(owner.company_id, date(2026, 2, 15), "-300.00")
    await _add_transaction(owner.company_id, date(2025, 12, 31), "-1000.00")
    await _add_transaction(other_owner.company_id, date(2026, 2, 10), "-9000.00")

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/cash-flow",
        headers=owner.headers,
        params={
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "granularity": "month",
            "cash_balance": "1000.00",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_inflows"] == "1000.00"
    assert body["total_outflows"] == "1500.00"
    assert body["net_cash_flow"] == "-500.00"
    assert body["transaction_count"] == 3
    assert body["runway_status"] == "estimated"
    assert body["runway_months"] == "5.91"
    assert [bucket["period_start"] for bucket in body["buckets"]] == [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
    ]
    assert body["buckets"][2]["transaction_count"] == 0


async def test_daily_metrics_fill_missing_days_and_allow_viewer_reads(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    viewer = await actor_factory("viewer")
    await _add_transaction(viewer.company_id, date(2026, 2, 1), "40.00")
    await _add_transaction(viewer.company_id, date(2026, 2, 3), "-5.00")

    response = await async_client.get(
        f"/api/v1/companies/{viewer.company_id}/metrics/cash-flow",
        headers=viewer.headers,
        params={
            "start_date": "2026-02-01",
            "end_date": "2026-02-03",
            "granularity": "day",
        },
    )

    assert response.status_code == 200
    assert len(response.json()["buckets"]) == 3
    assert response.json()["buckets"][1]["net_cash_flow"] == "0.00"
    assert response.json()["runway_status"] == "cash_balance_required"


async def test_default_window_clamps_at_earliest_supported_date(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/cash-flow",
        headers=owner.headers,
        params={"end_date": "0001-01-01"},
    )

    assert response.status_code == 200
    assert response.json()["start_date"] == "0001-01-01"
    assert response.json()["end_date"] == "0001-01-01"


@pytest.mark.parametrize(
    "params",
    [
        {"start_date": "2026-02-01", "end_date": "2026-01-01"},
        {"start_date": "2025-01-01", "end_date": "2026-01-02"},
        {"start_date": "2026-01-01", "end_date": "2026-01-01", "cash_balance": "NaN"},
        {"start_date": "2026-01-01", "end_date": "2026-01-01", "cash_balance": "10000000000"},
    ],
)
async def test_cash_flow_rejects_invalid_range_and_balance(
    async_client: AsyncClient, actor_factory: Any, params: dict[str, str]
) -> None:
    owner = await actor_factory("owner")
    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/cash-flow",
        headers=owner.headers,
        params=params,
    )

    assert response.status_code == 422


async def test_non_member_cannot_read_cash_flow_metrics(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/cash-flow",
        headers=other_owner.headers,
    )

    assert response.status_code == 403


async def test_budget_vs_actual_uses_company_scoped_signed_totals(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    food_id = await _add_category(None, "Food", "expense")
    sales_id = await _add_category(owner.company_id, "Sales", "income")
    await _add_budget(owner.company_id, food_id, "2026-01", "500.00")
    await _add_budget(owner.company_id, sales_id, "2026-01", "200.00")
    await _add_transaction(owner.company_id, date(2026, 1, 5), "-600.00", food_id)
    await _add_transaction(owner.company_id, date(2026, 1, 10), "150.00", sales_id)
    await _add_transaction(owner.company_id, date(2026, 2, 1), "-500.00", food_id)
    await _add_transaction(other_owner.company_id, date(2026, 1, 6), "-999.00", food_id)

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/budget-vs-actual",
        headers=owner.headers,
        params={"period": "2026-01"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_budgeted"] == "700.00"
    assert body["total_actual"] == "750.00"
    items = {item["category_name"]: item for item in body["items"]}
    assert items["Food"]["actual_amount"] == "600.00"
    assert items["Food"]["remaining_amount"] == "-100.00"
    assert items["Food"]["utilization_percent"] == "120.00"
    assert items["Food"]["over_budget"] is True
    assert items["Sales"]["actual_amount"] == "150.00"
    assert items["Sales"]["remaining_amount"] == "50.00"


async def test_budget_vs_actual_validates_month_format(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")

    for period in ("2026-13", "0000-01"):
        response = await async_client.get(
            f"/api/v1/companies/{owner.company_id}/metrics/budget-vs-actual",
            headers=owner.headers,
            params={"period": period},
        )
        assert response.status_code == 422

    maximum_period = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/metrics/budget-vs-actual",
        headers=owner.headers,
        params={"period": "9999-12"},
    )
    assert maximum_period.status_code == 200


async def test_budget_updates_reject_null_required_fields(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    category_id = await _add_category(owner.company_id, "Budget expense")
    created = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/budgets",
        headers=owner.headers,
        json={
            "category_id": str(category_id),
            "period": "2026-01",
            "limit_amount": "100.00",
        },
    )
    assert created.status_code == 201

    response = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}/budgets/{created.json()['id']}",
        headers=owner.headers,
        json={"period": None},
    )

    assert response.status_code == 422
