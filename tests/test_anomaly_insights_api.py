from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _explanation_response(explanation: str) -> object:
    return SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                name="explain_spending_anomalies",
                input={
                    "explanations": [
                        {"anomaly_id": "0", "explanation": explanation}
                    ]
                },
            )
        ],
        usage=SimpleNamespace(input_tokens=12, output_tokens=8),
    )


async def _add_category(company_id: UUID, name: str = "Supplies") -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=company_id, name=name, kind=CategoryKind.expense
        )
        session.add(category)
        await session.commit()
        return category.id


async def _add_expense(
    company_id: UUID,
    amount: str,
    transaction_date: date,
    *,
    description: str | None,
    category_id: UUID | None = None,
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
                source=TransactionSource.manual,
            )
        )
        await session.commit()


async def test_vendor_anomaly_is_scoped_and_explanation_is_grounded(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    other = await actor_factory("owner")
    today = datetime.now(UTC).date()
    for offset, description in [(40, "Acme Shop"), (35, "ACME-SHOP"), (30, "Acme shop!")]:
        await _add_expense(
            owner.company_id,
            "-100.00",
            today - timedelta(days=offset),
            description=description,
        )
    await _add_expense(
        owner.company_id, "-400.00", today, description="Acme Shop"
    )
    await _add_expense(
        other.company_id, "-100000.00", today - timedelta(days=10), description="Acme Shop"
    )
    fake_chat_client.messages.responses.append(
        _explanation_response("This vendor expense is unusually high compared with its history.")
    )

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/insights/anomalies",
        headers=owner.headers,
        params={"days": 7, "baseline_days": 90},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scanned_transactions"] == 1
    assert body["scan_truncated"] is False
    assert len(body["anomalies"]) == 1
    anomaly = body["anomalies"][0]
    assert anomaly["comparison_basis"] == "vendor"
    assert anomaly["amount"] == "400.00"
    assert anomaly["baseline_average"] == "100.00"
    assert anomaly["baseline_transaction_count"] == 3
    assert anomaly["ratio_to_average"] == "4.00"
    assert anomaly["explanation_source"] == "llm"
    assert "unusually high" in anomaly["explanation"]
    prompt = fake_chat_client.messages.calls[0]["messages"][0]["content"]
    assert "400.00" not in prompt
    assert "100.00" not in prompt
    assert "100000.00" not in prompt


async def test_category_baseline_is_used_when_vendor_history_is_insufficient(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    category_id = await _add_category(owner.company_id, "Office supplies")
    today = datetime.now(UTC).date()
    for offset, amount, description in [
        (40, "-20.00", "Office purchase one"),
        (35, "-25.00", "Office purchase two"),
        (30, "-30.00", "Office purchase three"),
    ]:
        await _add_expense(
            owner.company_id,
            amount,
            today - timedelta(days=offset),
            description=description,
            category_id=category_id,
        )
    await _add_expense(
        owner.company_id,
        "-200.00",
        today,
        description="New stationery vendor",
        category_id=category_id,
    )
    fake_chat_client.messages.responses.append(
        _explanation_response("This category expense is unusually high compared with previous spending.")
    )

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/insights/anomalies",
        headers=owner.headers,
        params={"days": 7, "baseline_days": 90},
    )

    assert response.status_code == 200, response.text
    anomaly = response.json()["anomalies"][0]
    assert anomaly["comparison_basis"] == "category"
    assert anomaly["category_name"] == "Office supplies"
    assert anomaly["baseline_transaction_count"] == 3
    assert anomaly["ratio_to_average"] == "8.00"


async def test_invalid_model_explanation_and_timeout_use_deterministic_fallback(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    today = datetime.now(UTC).date()
    for offset in (40, 35, 30):
        await _add_expense(
            owner.company_id,
            "-50.00",
            today - timedelta(days=offset),
            description="Corner Market",
        )
    await _add_expense(
        owner.company_id, "-300.00", today, description="Corner Market"
    )
    fake_chat_client.messages.responses.append(TimeoutError("simulated timeout"))

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/insights/anomalies",
        headers=owner.headers,
        params={"days": 7, "baseline_days": 90},
    )

    assert response.status_code == 200, response.text
    anomaly = response.json()["anomalies"][0]
    assert anomaly["explanation_source"] == "deterministic"
    assert "6.00 times" in anomaly["explanation"]


async def test_insufficient_history_returns_no_anomalies_without_model_call(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("viewer")
    today = datetime.now(UTC).date()
    await _add_expense(
        owner.company_id, "-900.00", today, description="First time vendor"
    )
    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/insights/anomalies",
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["anomalies"] == []
    assert fake_chat_client.messages.calls == []


async def test_anomaly_access_requires_membership_and_bounds_parameters(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    stranger = await actor_factory("viewer")
    url = f"/api/v1/companies/{owner.company_id}/insights/anomalies"
    forbidden = await async_client.get(url, headers=stranger.headers)
    invalid = await async_client.get(url, headers=owner.headers, params={"days": 0})
    assert forbidden.status_code == 403
    assert invalid.status_code == 422


async def test_anomaly_model_rate_limit_falls_back_without_losing_results(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import settings

    owner = await actor_factory("owner")
    monkeypatch.setattr(settings, "anomaly_max_explanations_per_minute", 1)
    today = datetime.now(UTC).date()
    for offset in (40, 35, 30):
        await _add_expense(
            owner.company_id,
            "-100.00",
            today - timedelta(days=offset),
            description="Repeated merchant",
        )
    await _add_expense(
        owner.company_id, "-500.00", today, description="Repeated merchant"
    )
    fake_chat_client.messages.responses.append(
        _explanation_response("This expense is unusually high compared with earlier charges.")
    )
    url = f"/api/v1/companies/{owner.company_id}/insights/anomalies"
    first = await async_client.get(url, headers=owner.headers)
    second = await async_client.get(url, headers=owner.headers)
    assert first.status_code == second.status_code == 200
    assert first.json()["anomalies"][0]["explanation_source"] == "llm"
    assert second.json()["anomalies"][0]["explanation_source"] == "deterministic"
    assert len(fake_chat_client.messages.calls) == 1
