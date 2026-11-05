from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _tool_response(
    query_type: str = "cash_flow_summary",
    period: str = "this_month",
    category_name: str | None = None,
    **extra: Any,
) -> object:
    value = {
        "query_type": query_type,
        "period": period,
        "category_name": category_name,
        **extra,
    }
    return SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use", name="select_financial_query", input=value
            )
        ],
        usage=SimpleNamespace(input_tokens=12, output_tokens=5),
    )


async def _add_category(company_id: UUID | None, name: str, kind: str = "expense") -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(company_id=company_id, name=name, kind=CategoryKind(kind))
        session.add(category)
        await session.commit()
        return category.id


async def _add_transaction(
    company_id: UUID,
    amount: str,
    *,
    transaction_date: date | None = None,
    description: str = "Fixture transaction",
    category_id: UUID | None = None,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction, TransactionSource

    async with AsyncSessionLocal() as session:
        session.add(
            Transaction(
                company_id=company_id,
                date=transaction_date or datetime.now(UTC).date(),
                amount=Decimal(amount),
                description=description,
                category_id=category_id,
                source=TransactionSource.manual,
            )
        )
        await session.commit()


async def _audits(company_id: UUID) -> list[object]:
    from sqlalchemy import select

    from app.core.db import AsyncSessionLocal
    from app.models import ChatQuery

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ChatQuery).where(ChatQuery.company_id == company_id)
        )
        return list(result.scalars())


async def test_cash_flow_query_is_deterministic_scoped_and_audited(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_chat_client: Any,
) -> None:
    owner = await actor_factory("owner")
    other = await actor_factory("owner")
    today = datetime.now(UTC).date()
    await _add_transaction(owner.company_id, "450.00", description="private vendor", transaction_date=today)
    await _add_transaction(owner.company_id, "-125.50", transaction_date=today)
    await _add_transaction(other.company_id, "-99000.00", transaction_date=today)
    fake_chat_client.messages.responses.append(_tool_response())

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "Summarize cash flow this month"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["facts"]["inflows"] == "450.00"
    assert body["facts"]["outflows"] == "125.50"
    assert body["facts"]["net_cash_flow"] == "324.50"
    assert body["facts"]["transaction_count"] == 2
    assert body["start_date"] == today.replace(day=1).isoformat()
    prompt = fake_chat_client.messages.calls[0]["messages"][0]["content"]
    assert "private vendor" not in prompt
    audit = (await _audits(owner.company_id))[0]
    assert audit.generated_sql is None
    assert audit.executed is True
    assert audit.query_plan == {
        "query_type": "cash_flow_summary",
        "period": "this_month",
        "category_name": None,
    }
    assert audit.result_data["outflows"] == "125.50"


async def test_expense_category_filter_and_largest_expense_are_bounded(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    rent = await _add_category(owner.company_id, "Rent")
    food = await _add_category(None, "Food")
    today = datetime.now(UTC).date()
    await _add_transaction(owner.company_id, "-200.00", category_id=rent, transaction_date=today)
    await _add_transaction(owner.company_id, "-30.00", category_id=food, transaction_date=today)

    fake_chat_client.messages.responses.append(
        _tool_response("expenses_by_category", category_name="Rent")
    )
    category_response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "How much did rent cost?"},
    )
    assert category_response.status_code == 200, category_response.text
    assert category_response.json()["facts"]["items"] == [
        {
            "category_id": str(rent),
            "category_name": "Rent",
            "amount": "200.00",
            "transaction_count": 1,
        }
    ]

    fake_chat_client.messages.responses.append(
        _tool_response("largest_expenses", category_name="Food")
    )
    largest_response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "Show the largest food expense"},
    )
    assert largest_response.status_code == 200, largest_response.text
    largest = largest_response.json()["facts"]["items"]
    assert len(largest) == 1
    assert largest[0]["amount"] == "30.00"
    assert largest[0]["category_name"] == "Food"


async def test_budget_query_uses_only_company_budget_and_period(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Budget

    owner = await actor_factory("owner")
    other = await actor_factory("owner")
    category_id = await _add_category(owner.company_id, "Supplies")
    other_category = await _add_category(other.company_id, "Supplies")
    current_month = datetime.now(UTC).date().strftime("%Y-%m")
    async with AsyncSessionLocal() as session:
        session.add_all(
            [
                Budget(company_id=owner.company_id, category_id=category_id, period=current_month, limit_amount=Decimal("500")),
                Budget(company_id=other.company_id, category_id=other_category, period=current_month, limit_amount=Decimal("9000")),
            ]
        )
        await session.commit()
    today = datetime.now(UTC).date()
    await _add_transaction(owner.company_id, "-125.00", category_id=category_id, transaction_date=today)
    await _add_transaction(other.company_id, "-8000.00", category_id=other_category, transaction_date=today)
    fake_chat_client.messages.responses.append(_tool_response("budget_vs_actual"))

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "Compare this month's budgets"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["facts"]["total_budgeted"] == "500.00"
    assert response.json()["facts"]["total_actual"] == "125.00"


async def test_invalid_plan_and_unsupported_question_never_execute_queries(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    fake_chat_client.messages.responses.extend(
        [
            _tool_response("cash_flow_summary", sql="DELETE FROM transactions"),
            _tool_response("unsupported"),
        ]
    )

    invalid = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "do something"},
    )
    unsupported = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "tell me a joke"},
    )
    assert invalid.status_code == unsupported.status_code == 200
    assert invalid.json()["supported"] is False
    assert unsupported.json()["supported"] is False
    rows = await _audits(owner.company_id)
    assert len(rows) == 2
    assert all(row.executed is False and row.result_data is None for row in rows)
    assert all(row.generated_sql is None for row in rows)
    assert {row.error_code for row in rows} == {"invalid_plan", "unsupported"}


async def test_invalid_category_name_is_rejected_and_member_scope_is_enforced(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    stranger = await actor_factory("viewer")
    fake_chat_client.messages.responses.append(
        _tool_response("expenses_by_category", category_name="Secret")
    )
    invalid = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "Show a category"},
    )
    forbidden = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=stranger.headers,
        json={"question": "Show cash flow"},
    )
    assert invalid.status_code == 200 and invalid.json()["supported"] is False
    assert forbidden.status_code == 403
    assert len(await _audits(owner.company_id)) == 1


async def test_viewer_can_read_and_rate_limit_is_per_user(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import settings

    viewer = await actor_factory("viewer")
    monkeypatch.setattr(settings, "financial_qa_max_queries_per_minute", 1)
    fake_chat_client.messages.responses.append(_tool_response())
    url = f"/api/v1/companies/{viewer.company_id}/chat/query"
    accepted = await async_client.post(
        url, headers=viewer.headers, json={"question": "cash flow"}
    )
    limited = await async_client.post(
        url, headers=viewer.headers, json={"question": "cash flow again"}
    )
    assert accepted.status_code == 200
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0
    assert len(fake_chat_client.messages.calls) == 1


async def test_model_failure_is_audited_and_returns_service_unavailable(
    async_client: AsyncClient, actor_factory: Any, fake_chat_client: Any
) -> None:
    owner = await actor_factory("owner")
    fake_chat_client.messages.responses.append(TimeoutError("simulated timeout"))
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "cash flow"},
    )
    assert response.status_code == 503
    audit = (await _audits(owner.company_id))[0]
    assert audit.error_code == "model_unavailable"
    assert audit.executed is False
    assert audit.generated_sql is None


async def test_database_query_failure_leaves_audited_nonexecuted_row(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.routes.chat as chat_route

    owner = await actor_factory("owner")
    fake_chat_client.messages.responses.append(_tool_response())

    async def fail_query(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("simulated query failure")

    monkeypatch.setattr(chat_route, "execute_plan", fail_query)
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/chat/query",
        headers=owner.headers,
        json={"question": "cash flow"},
    )
    assert response.status_code == 500
    audit = (await _audits(owner.company_id))[0]
    assert audit.error_code == "query_failed"
    assert audit.executed is False
    assert audit.query_plan["query_type"] == "cash_flow_summary"


async def test_question_validation_rejects_blank_and_overlong_input(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    url = f"/api/v1/companies/{owner.company_id}/chat/query"
    blank = await async_client.post(url, headers=owner.headers, json={"question": "  "})
    long = await async_client.post(url, headers=owner.headers, json={"question": "x" * 1001})
    assert blank.status_code == 422
    assert long.status_code == 422
