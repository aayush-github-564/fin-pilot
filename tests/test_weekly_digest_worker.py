from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _summary_response(summary: str) -> object:
    return SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                name="write_weekly_summary",
                input={"summary": summary},
            )
        ],
        usage=SimpleNamespace(input_tokens=14, output_tokens=10),
    )


async def _add_transaction(
    company_id: UUID,
    amount: str,
    transaction_date: date,
    *,
    description: str,
    category_id: UUID | None = None,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Transaction, TransactionSource

    async with AsyncSessionLocal() as session:
        session.add(
            Transaction(
                company_id=company_id,
                amount=Decimal(amount),
                date=transaction_date,
                description=description,
                category_id=category_id,
                source=TransactionSource.manual,
            )
        )
        await session.commit()


async def _add_expense_category(company_id: UUID, name: str = "Supplies") -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=company_id, name=name, kind=CategoryKind.expense
        )
        session.add(category)
        await session.commit()
        return category.id


async def _add_member(company_id: UUID, role: str, email: str) -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import CompanyMember, CompanyRole, User

    async with AsyncSessionLocal() as session:
        user = User(email=email, hashed_password="test-only")
        session.add(user)
        await session.flush()
        session.add(
            CompanyMember(
                company_id=company_id,
                user_id=user.id,
                role=CompanyRole(role),
            )
        )
        await session.commit()
        return user.id


async def _add_budget(
    company_id: UUID, category_id: UUID, period: str, limit_amount: str
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Budget

    async with AsyncSessionLocal() as session:
        session.add(
            Budget(
                company_id=company_id,
                category_id=category_id,
                period=period,
                limit_amount=Decimal(limit_amount),
            )
        )
        await session.commit()


async def test_weekly_scheduler_enqueues_only_companies_with_delivery_roles(
    actor_factory: Any, fake_arq_pool: Any
) -> None:
    from app.services.weekly_digest import previous_full_week
    from app.worker import schedule_weekly_digests

    owner = await actor_factory("owner")
    await actor_factory("viewer")
    ctx = {"redis": fake_arq_pool}

    enqueued = await schedule_weekly_digests(ctx)

    start, end = previous_full_week()
    assert enqueued == 1
    assert len(fake_arq_pool.jobs) == 1
    job = fake_arq_pool.jobs[0]
    assert job["function_name"] == "generate_weekly_digest"
    assert job["args"] == (str(owner.company_id), start.isoformat())
    assert start.weekday() == 0 and end.weekday() == 6
    assert job["job_id"] == f"weekly-digest:{owner.company_id}:{start.isoformat()}"


async def test_weekly_digest_aggregates_company_facts_and_is_idempotent(
    actor_factory: Any,
    fake_arq_pool: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from app.core.config import settings
    from app.core.db import AsyncSessionLocal
    from app.models import WeeklyDigest, WeeklyDigestDelivery
    from app.worker import generate_weekly_digest

    owner = await actor_factory("owner")
    viewer = await _add_member(
        owner.company_id, "viewer", "digest-viewer@example.com"
    )
    accountant = await _add_member(
        owner.company_id, "accountant", "digest-accountant@example.com"
    )
    other = await actor_factory("owner")
    monkeypatch.setattr(settings, "digest_smtp_host", None)
    monkeypatch.setattr(settings, "digest_email_from", None)

    period_start = date(2026, 10, 26)
    category_id = await _add_expense_category(owner.company_id)
    await _add_transaction(owner.company_id, "1000.00", period_start + timedelta(days=1), description="Sales")
    await _add_transaction(owner.company_id, "-200.00", period_start + timedelta(days=2), description="Office", category_id=category_id)
    await _add_transaction(owner.company_id, "-50.00", period_start + timedelta(days=6), description="Office", category_id=category_id)
    await _add_transaction(owner.company_id, "-100.00", period_start - timedelta(days=1), description="Prior week")
    await _add_transaction(other.company_id, "-100000.00", period_start + timedelta(days=2), description="Secret expense")
    await _add_budget(owner.company_id, category_id, "2026-11", "400.00")
    fake_chat_client.messages.responses.append(
        _summary_response("Cash flow was positive while expenses were recorded in the reporting period.")
    )
    ctx = {
        "redis": fake_arq_pool,
        "weekly_digest_client": fake_chat_client,
    }

    digest_id = await generate_weekly_digest(
        ctx, str(owner.company_id), period_start.isoformat()
    )
    duplicate_id = await generate_weekly_digest(
        ctx, str(owner.company_id), period_start.isoformat()
    )

    assert digest_id == duplicate_id
    assert len(fake_chat_client.messages.calls) == 1
    async with AsyncSessionLocal() as session:
        digest_result = await session.execute(
            select(WeeklyDigest).where(WeeklyDigest.id == UUID(digest_id))
        )
        digest = digest_result.scalar_one()
        deliveries = list(
            (
                await session.execute(
                    select(WeeklyDigestDelivery).where(
                        WeeklyDigestDelivery.digest_id == digest.id
                    )
                )
            ).scalars()
        )
    assert digest.period_end == date(2026, 11, 1)
    assert digest.summary_source == "llm"
    assert digest.facts["current_week"]["inflows"] == "1000.00"
    assert digest.facts["current_week"]["outflows"] == "250.00"
    assert digest.facts["current_week"]["net_cash_flow"] == "750.00"
    assert digest.facts["previous_week"]["outflows"] == "100.00"
    assert digest.facts["month_to_date_budget"]["total_budgeted"] == "400.00"
    assert digest.facts["month_to_date_budget"]["total_actual"] == "50.00"
    assert "Secret expense" not in str(fake_chat_client.messages.calls[0])
    assert {delivery.user_id for delivery in deliveries} == {owner.user_id, accountant}
    assert viewer not in {delivery.user_id for delivery in deliveries}
    assert all(delivery.status == "not_configured" for delivery in deliveries)


async def test_digest_delivery_is_per_recipient_and_records_success(
    actor_factory: Any,
    fake_arq_pool: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from app.core.config import settings
    from app.core.db import AsyncSessionLocal
    from app.models import User, WeeklyDigestDelivery
    from app.worker import deliver_weekly_digest, generate_weekly_digest

    owner = await actor_factory("owner")
    accountant = await _add_member(
        owner.company_id, "accountant", "delivery-accountant@example.com"
    )
    await _add_member(owner.company_id, "viewer", "delivery-viewer@example.com")
    monkeypatch.setattr(settings, "digest_smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "digest_email_from", "reports@example.test")
    period_start = date(2026, 10, 26)
    fake_chat_client.messages.responses.append(
        _summary_response("Cash flow remained balanced during the reporting period.")
    )
    sent: list[dict[str, str]] = []

    async def fake_sender(**kwargs: str) -> None:
        sent.append(kwargs)

    ctx = {
        "redis": fake_arq_pool,
        "weekly_digest_client": fake_chat_client,
        "send_weekly_digest_email": fake_sender,
    }
    digest_id = await generate_weekly_digest(
        ctx, str(owner.company_id), period_start.isoformat()
    )
    async with AsyncSessionLocal() as session:
        deliveries = list(
            (
                await session.execute(
                    select(WeeklyDigestDelivery).where(
                        WeeklyDigestDelivery.digest_id == UUID(digest_id)
                    )
                )
            ).scalars()
        )
    assert len(deliveries) == 2
    assert len(fake_arq_pool.jobs) == 2

    for delivery in deliveries:
        await deliver_weekly_digest(ctx, str(delivery.id))

    async with AsyncSessionLocal() as session:
        expected_emails = set(
            (
                await session.execute(
                    select(User.email).where(User.id.in_([owner.user_id, accountant]))
                )
            ).scalars()
        )
    assert {item["recipient"] for item in sent} == expected_emails
    assert all("Inflows:" in item["body"] for item in sent)
    assert all("delivery-viewer@example.com" not in item["body"] for item in sent)
    async with AsyncSessionLocal() as session:
        refreshed = list(
            (
                await session.execute(
                    select(WeeklyDigestDelivery).where(
                        WeeklyDigestDelivery.digest_id == UUID(digest_id)
                    )
                )
            ).scalars()
        )
    assert all(item.status == "sent" and item.attempt_count == 1 for item in refreshed)
    assert {item.user_id for item in refreshed} == {owner.user_id, accountant}


async def test_digest_delivery_failure_is_retryable_and_bounded(
    actor_factory: Any,
    fake_arq_pool: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from app.core.config import settings
    from app.core.db import AsyncSessionLocal
    from app.models import WeeklyDigestDelivery
    from app.worker import deliver_weekly_digest, generate_weekly_digest, sweep_weekly_digest_deliveries

    owner = await actor_factory("owner")
    monkeypatch.setattr(settings, "digest_smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "digest_email_from", "reports@example.test")
    period_start = date(2026, 10, 26)
    fake_chat_client.messages.responses.append(
        _summary_response("Cash flow was positive during the reporting period.")
    )

    async def fail_sender(**kwargs: str) -> None:
        raise TimeoutError("simulated SMTP timeout")

    ctx = {
        "redis": fake_arq_pool,
        "weekly_digest_client": fake_chat_client,
        "send_weekly_digest_email": fail_sender,
    }
    digest_id = await generate_weekly_digest(
        ctx, str(owner.company_id), period_start.isoformat()
    )
    async with AsyncSessionLocal() as session:
        delivery = (
            await session.execute(
                select(WeeklyDigestDelivery).where(
                    WeeklyDigestDelivery.digest_id == UUID(digest_id)
                )
            )
        ).scalar_one()
    await deliver_weekly_digest(ctx, str(delivery.id))
    async with AsyncSessionLocal() as session:
        failed = await session.get(WeeklyDigestDelivery, delivery.id)
        assert failed is not None
        assert failed.status == "failed"
        assert failed.last_error_code == "TimeoutError"
        assert failed.attempt_count == 1

    queued = await sweep_weekly_digest_deliveries(ctx)
    assert queued == 1
    assert any(
        job["job_id"] == f"weekly-digest-delivery:{delivery.id}:1"
        for job in fake_arq_pool.jobs
    )


async def test_digest_delivery_skips_recipient_after_role_revocation(
    actor_factory: Any,
    fake_arq_pool: Any,
    fake_chat_client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from app.core.config import settings
    from app.core.db import AsyncSessionLocal
    from app.models import CompanyMember, WeeklyDigestDelivery
    from app.worker import deliver_weekly_digest, generate_weekly_digest

    owner = await actor_factory("owner")
    accountant = await _add_member(
        owner.company_id, "accountant", "revoked-accountant@example.com"
    )
    monkeypatch.setattr(settings, "digest_smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "digest_email_from", "reports@example.test")
    period_start = date(2026, 10, 26)
    fake_chat_client.messages.responses.append(
        _summary_response("Cash flow remained balanced during the reporting period.")
    )
    sent: list[str] = []

    async def fake_sender(**kwargs: str) -> None:
        sent.append(kwargs["recipient"])

    ctx = {
        "redis": fake_arq_pool,
        "weekly_digest_client": fake_chat_client,
        "send_weekly_digest_email": fake_sender,
    }
    digest_id = await generate_weekly_digest(
        ctx, str(owner.company_id), period_start.isoformat()
    )
    async with AsyncSessionLocal() as session:
        delivery = (
            await session.execute(
                select(WeeklyDigestDelivery).where(
                    WeeklyDigestDelivery.digest_id == UUID(digest_id),
                    WeeklyDigestDelivery.user_id == accountant,
                )
            )
        ).scalar_one()
        membership = (
            await session.execute(
                select(CompanyMember).where(
                    CompanyMember.company_id == owner.company_id,
                    CompanyMember.user_id == accountant,
                )
            )
        ).scalar_one()
        await session.delete(membership)
        await session.commit()

    await deliver_weekly_digest(ctx, str(delivery.id))

    async with AsyncSessionLocal() as session:
        assert await session.get(WeeklyDigestDelivery, delivery.id) is None
    assert "revoked-accountant@example.com" not in sent
