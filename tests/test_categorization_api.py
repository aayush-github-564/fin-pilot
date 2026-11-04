from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _add_category(
    company_id: Any,
    name: str,
    *,
    kind: str = "expense",
) -> Any:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=company_id,
            name=name,
            kind=CategoryKind(kind),
        )
        session.add(category)
        await session.commit()
        return category.id


async def _add_review_transaction(
    company_id: Any,
    *,
    amount: str = "-15.00",
    category_id: Any = None,
    confidence: str | None = "0.64",
) -> Any:
    from app.core.db import AsyncSessionLocal
    from app.models import (
        CategorizationStatus,
        Category,
        Transaction,
        TransactionSource,
    )

    async with AsyncSessionLocal() as session:
        suggestion = Category(
            company_id=company_id,
            name="Suggested expense",
        )
        session.add(suggestion)
        await session.flush()
        transaction = Transaction(
            company_id=company_id,
            date=date(2026, 1, 5),
            amount=Decimal(amount),
            description="Review transaction",
            category_id=category_id,
            suggested_category_id=suggestion.id if confidence is not None else None,
            suggestion_confidence=Decimal(confidence) if confidence is not None else None,
            source=TransactionSource.manual,
            categorization_status=CategorizationStatus.needs_review,
        )
        session.add(transaction)
        await session.commit()
        return transaction.id, suggestion.id


async def test_uncategorized_create_commits_before_enqueue(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import CategorizationStatus, Transaction
    from sqlalchemy import select

    owner = await actor_factory("owner")
    original_enqueue = fake_arq_pool.enqueue_job

    async def verify_committed_before_enqueue(
        function_name: str, *args: Any, _job_id: str | None = None, **kwargs: Any
    ) -> Any:
        async with AsyncSessionLocal() as session:
            transaction = await session.scalar(
                select(Transaction).where(Transaction.id == args[0])
            )
            assert transaction is not None
            assert transaction.categorization_status == CategorizationStatus.pending
        return await original_enqueue(
            function_name, *args, _job_id=_job_id, **kwargs
        )

    monkeypatch.setattr(fake_arq_pool, "enqueue_job", verify_committed_before_enqueue)
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={"date": "2026-01-05", "amount": "-18.25", "description": "Unmatched"},
    )

    assert response.status_code == 201
    transaction_id = response.json()["id"]
    request_id = response.headers["X-Request-ID"]
    UUID(request_id)
    assert response.json()["categorization_status"] == "pending"
    assert fake_arq_pool.jobs == [
        {
            "function_name": "categorize_transaction",
            "args": (transaction_id, request_id),
            "job_id": f"categorize:{transaction_id}",
        }
    ]


async def test_enqueue_failure_keeps_transaction_pending(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await actor_factory("owner")

    async def unavailable(*args: Any, **kwargs: Any) -> None:
        raise ConnectionError("queue unavailable")

    monkeypatch.setattr(fake_arq_pool, "enqueue_job", unavailable)
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={"date": "2026-01-05", "amount": "-18.25", "description": "Unmatched"},
    )

    assert response.status_code == 201
    assert response.json()["categorization_status"] == "pending"


async def test_health_response_includes_request_id(async_client: AsyncClient) -> None:
    response = await async_client.get("/health")

    assert response.status_code == 200
    assert UUID(response.headers["X-Request-ID"])


async def test_rule_categorization_respects_direction_and_longest_match(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
) -> None:
    from app.scripts.seed_categories import seed_categories

    owner = await actor_factory("owner")
    await seed_categories()
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={
            "date": "2026-01-05",
            "amount": "-118.00",
            "description": "Rent a car for client travel",
        },
    )

    assert response.status_code == 201
    assert response.json()["categorization_status"] == "done"
    assert response.json()["categorization_source"] == "rule"
    assert response.json()["category_id"] is not None
    assert fake_arq_pool.jobs == []


async def test_inflow_does_not_take_an_expense_rule(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
) -> None:
    from app.scripts.seed_categories import seed_categories

    owner = await actor_factory("owner")
    await seed_categories()
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={
            "date": "2026-01-05",
            "amount": "18.00",
            "description": "Uber Eats refund",
        },
    )

    assert response.status_code == 201
    assert response.json()["category_id"] is None
    assert response.json()["categorization_status"] == "pending"
    assert fake_arq_pool.jobs[0]["function_name"] == "categorize_transaction"


async def test_zero_amount_goes_to_review_without_llm_enqueue(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
) -> None:
    owner = await actor_factory("owner")
    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={"date": "2026-01-05", "amount": "0.00", "description": "Zero"},
    )

    assert response.status_code == 201
    assert response.json()["categorization_status"] == "needs_review"
    assert fake_arq_pool.jobs == []


async def test_review_acceptance_is_company_scoped_and_audited(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    transaction_id, suggestion_id = await _add_review_transaction(owner.company_id)
    await _add_review_transaction(other_owner.company_id)

    review_response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/transactions/review",
        headers=owner.headers,
    )
    assert review_response.status_code == 200
    assert [row["id"] for row in review_response.json()] == [str(transaction_id)]

    accept_response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions/{transaction_id}/accept-suggestion",
        headers=owner.headers,
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["category_id"] == str(suggestion_id)
    assert accept_response.json()["categorization_status"] == "done"
    assert accept_response.json()["categorization_source"] == "llm_confirmed"
    assert accept_response.json()["suggestion_confidence"] == "0.64"


async def test_viewer_cannot_accept_a_suggestion(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    viewer = await actor_factory("viewer")
    transaction_id, _ = await _add_review_transaction(viewer.company_id)

    response = await async_client.post(
        f"/api/v1/companies/{viewer.company_id}/transactions/{transaction_id}/accept-suggestion",
        headers=viewer.headers,
    )

    assert response.status_code == 403


async def test_manual_override_marks_user_source_and_keeps_suggestion(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    transaction_id, suggestion_id = await _add_review_transaction(owner.company_id)
    manual_category_id = await _add_category(owner.company_id, "Manual override")

    response = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}/transactions/{transaction_id}",
        headers=owner.headers,
        json={"category_id": str(manual_category_id)},
    )

    assert response.status_code == 200
    assert response.json()["category_id"] == str(manual_category_id)
    assert response.json()["suggested_category_id"] == str(suggestion_id)
    assert response.json()["categorization_status"] == "done"
    assert response.json()["categorization_source"] == "user"


async def test_transaction_category_kind_must_match_amount_direction(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    expense_category_id = await _add_category(owner.company_id, "Expense only")

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions",
        headers=owner.headers,
        json={
            "date": "2026-01-05",
            "amount": "18.00",
            "description": "Inflow",
            "category_id": str(expense_category_id),
        },
    )

    assert response.status_code == 422


async def test_category_kind_cannot_change_when_linked_transactions_conflict(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    category_id = await _add_category(owner.company_id, "Assigned expense")
    await _add_review_transaction(
        owner.company_id, category_id=category_id, confidence=None
    )

    response = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}/categories/{category_id}",
        headers=owner.headers,
        json={"kind": "income"},
    )

    assert response.status_code == 409


@pytest.mark.parametrize("payload", [{"kind": None}, {"name": None}])
async def test_category_required_fields_reject_null_updates(
    async_client: AsyncClient, actor_factory: Any, payload: dict[str, Any]
) -> None:
    owner = await actor_factory("owner")
    category_id = await _add_category(owner.company_id, "Category")

    response = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}/categories/{category_id}",
        headers=owner.headers,
        json=payload,
    )

    assert response.status_code == 422
