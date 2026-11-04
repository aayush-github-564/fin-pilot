from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import anthropic
import httpx
import pytest
from arq import Retry
from sqlalchemy import func, select, update

pytestmark = pytest.mark.asyncio(loop_scope="session")


class StubCategorizationMessages:
    def __init__(self, answer: Any = None, *, error: Exception | None = None) -> None:
        self.answer = answer
        self.error = error
        self.calls: list[dict[str, Any]] = []
        self.before_response = None

    async def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self.before_response is not None:
            await self.before_response()
        if self.error is not None:
            raise self.error
        return SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    name="record_category",
                    input=self.answer,
                )
            ],
            usage=SimpleNamespace(input_tokens=25, output_tokens=7),
        )


class StubCategorizationClient:
    def __init__(self, messages: StubCategorizationMessages) -> None:
        self.messages = messages


async def _create_pending_transaction(
    company_id: UUID,
    *,
    amount: str = "-25.00",
    description: str = "Unmatched transaction",
) -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import CategorizationStatus, Transaction, TransactionSource

    async with AsyncSessionLocal() as session:
        transaction = Transaction(
            company_id=company_id,
            date=date(2026, 1, 5),
            amount=Decimal(amount),
            description=description,
            source=TransactionSource.manual,
            categorization_status=CategorizationStatus.pending,
        )
        session.add(transaction)
        await session.commit()
        return transaction.id


async def _create_category(
    company_id: UUID | None,
    name: str,
    *,
    kind: str = "expense",
) -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=company_id, name=name, kind=CategoryKind(kind)
        )
        session.add(category)
        await session.commit()
        return category.id


async def _read_transaction(transaction_id: UUID) -> Any:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction

    async with AsyncSessionLocal() as session:
        return await session.scalar(
            select(Transaction).where(Transaction.id == transaction_id)
        )


@pytest.mark.parametrize(
    ("answer", "expected_status", "expected_source", "expect_suggestion"),
    [
        ({"category": "Travel", "confidence": 0.95}, "done", "llm_auto", True),
        (
            {"category": "Travel", "confidence": 0.50},
            "needs_review",
            None,
            True,
        ),
        ({"category": None, "confidence": 0.20}, "needs_review", None, False),
        ({"category": "Not allowed", "confidence": 0.99}, "needs_review", None, False),
    ],
)
async def test_worker_applies_only_valid_confident_suggestions(
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
    answer: dict[str, Any],
    expected_status: str,
    expected_source: str | None,
    expect_suggestion: bool,
) -> None:
    from app.models import CategorizationStatus, CategoryKind
    from app.worker import categorize_transaction

    owner = await actor_factory("owner")
    category_id = await _create_category(
        owner.company_id, "Travel", kind=CategoryKind.expense.value
    )
    transaction_id = await _create_pending_transaction(owner.company_id)
    messages = StubCategorizationMessages(answer)
    monkeypatch.setattr(
        "app.worker.categorization_client", StubCategorizationClient(messages)
    )

    await categorize_transaction({"job_try": 1}, str(transaction_id))

    transaction = await _read_transaction(transaction_id)
    assert transaction.categorization_status.value == expected_status
    assert (
        transaction.categorization_source.value
        if transaction.categorization_source is not None
        else None
    ) == expected_source
    assert transaction.category_id == (category_id if expected_source else None)
    assert (transaction.suggested_category_id is not None) is expect_suggestion
    assert len(messages.calls) == 1


async def test_worker_log_carries_originating_request_id(
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.worker import categorize_transaction

    owner = await actor_factory("owner")
    await _create_category(owner.company_id, "Travel")
    transaction_id = await _create_pending_transaction(owner.company_id)
    messages = StubCategorizationMessages(
        {"category": "Travel", "confidence": 0.95}
    )
    monkeypatch.setattr(
        "app.worker.categorization_client", StubCategorizationClient(messages)
    )

    await categorize_transaction(
        {"job_try": 1}, str(transaction_id), "request-from-api"
    )

    job_log = next(
        record
        for record in caplog.records
        if record.getMessage() == "Transaction categorization job finished"
    )
    assert job_log.request_id == "request-from-api"


async def test_worker_filters_categories_by_tenant_and_direction(
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models import CategoryKind
    from app.worker import categorize_transaction

    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    global_id = await _create_category(None, "Shared", kind="income")
    company_id = await _create_category(owner.company_id, "Shared", kind="income")
    await _create_category(owner.company_id, "Local income", kind="income")
    await _create_category(owner.company_id, "Expense only", kind="expense")
    other_category_id = await _create_category(
        other_owner.company_id, "Other tenant secret", kind="income"
    )
    transaction_id = await _create_pending_transaction(
        owner.company_id, amount="125.00", description="Customer payment"
    )
    messages = StubCategorizationMessages(
        {"category": "Shared", "confidence": 0.99}
    )
    monkeypatch.setattr(
        "app.worker.categorization_client", StubCategorizationClient(messages)
    )

    await categorize_transaction({"job_try": 1}, str(transaction_id))

    category_enum = messages.calls[0]["tools"][0]["input_schema"]["properties"][
        "category"
    ]["anyOf"][0]["enum"]
    prompt = messages.calls[0]["messages"][0]["content"]
    assert category_enum == ["Local income", "Shared"]
    assert "Expense only" not in category_enum
    assert "Other tenant secret" not in category_enum
    assert str(other_category_id) not in prompt
    result = await _read_transaction(transaction_id)
    assert result.category_id == company_id
    assert company_id != global_id


async def test_worker_does_not_overwrite_manual_category_set_during_llm_call(
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import CategorizationSource, CategorizationStatus, Transaction
    from app.worker import categorize_transaction

    owner = await actor_factory("owner")
    suggested_id = await _create_category(owner.company_id, "Model category")
    manual_id = await _create_category(owner.company_id, "Manual category")
    transaction_id = await _create_pending_transaction(owner.company_id)
    messages = StubCategorizationMessages(
        {"category": "Model category", "confidence": 0.99}
    )

    async def set_manual_category() -> None:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Transaction)
                .where(Transaction.id == transaction_id)
                .values(
                    category_id=manual_id,
                    categorization_status=CategorizationStatus.done,
                    categorization_source=CategorizationSource.user,
                )
            )
            await session.commit()

    messages.before_response = set_manual_category
    monkeypatch.setattr(
        "app.worker.categorization_client", StubCategorizationClient(messages)
    )

    await categorize_transaction({"job_try": 1}, str(transaction_id))

    transaction = await _read_transaction(transaction_id)
    assert transaction.category_id == manual_id
    assert transaction.categorization_source == CategorizationSource.user
    assert transaction.suggested_category_id is None
    assert transaction.category_id != suggested_id


async def test_transient_failure_retries_then_marks_failed(
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models import CategorizationStatus
    from app.worker import categorize_transaction

    owner = await actor_factory("owner")
    await _create_category(owner.company_id, "Travel")
    transaction_id = await _create_pending_transaction(owner.company_id)
    transient_error = anthropic.APIConnectionError(
        request=httpx.Request("POST", "https://api.anthropic.com")
    )
    messages = StubCategorizationMessages(error=transient_error)
    monkeypatch.setattr(
        "app.worker.categorization_client", StubCategorizationClient(messages)
    )

    with pytest.raises(Retry):
        await categorize_transaction({"job_try": 1}, str(transaction_id))
    assert (await _read_transaction(transaction_id)).categorization_status == (
        CategorizationStatus.pending
    )

    await categorize_transaction({"job_try": 3}, str(transaction_id))
    assert (await _read_transaction(transaction_id)).categorization_status == (
        CategorizationStatus.failed
    )


async def test_sweeper_reenqueues_only_old_pending_rows(
    actor_factory: Any, fake_arq_pool: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction
    from app.worker import WorkerSettings, sweep_pending_categorization

    owner = await actor_factory("owner")
    stale_id = await _create_pending_transaction(owner.company_id)
    recent_id = await _create_pending_transaction(owner.company_id)
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(Transaction)
            .where(Transaction.id == stale_id)
            .values(created_at=func.now() - timedelta(minutes=10))
        )
        await session.commit()

    result = await sweep_pending_categorization({"redis": fake_arq_pool})

    assert result == 1
    assert fake_arq_pool.jobs == [
        {
            "function_name": "categorize_transaction",
            "args": (str(stale_id),),
            "job_id": f"categorize:{stale_id}",
        }
    ]
    assert str(recent_id) not in fake_arq_pool.jobs[0]["args"]
    assert len(WorkerSettings.cron_jobs) == 1
