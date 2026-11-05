from datetime import date
from types import SimpleNamespace

import pytest

from app.services.weekly_digest import (
    _send_email_sync,
    deterministic_digest_summary,
    generate_digest_summary,
    previous_full_week,
    render_digest_email,
)


def test_previous_full_week_is_utc_monday_through_sunday() -> None:
    assert previous_full_week(date(2026, 11, 5)) == (
        date(2026, 10, 26),
        date(2026, 11, 1),
    )
    assert previous_full_week(date(2026, 11, 2)) == (
        date(2026, 10, 26),
        date(2026, 11, 1),
    )


@pytest.mark.asyncio
async def test_llm_summary_is_constrained_and_rejects_numeric_claims() -> None:
    class Messages:
        response: object

        async def create(self, **kwargs: object) -> object:
            self.call = kwargs
            return self.response

    messages = Messages()
    messages.response = SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                name="write_weekly_summary",
                input={"summary": "Cash flow was positive and expenses were steady."},
            )
        ]
    )
    client = SimpleNamespace(messages=messages)
    facts = {"signals": {"net_cash_flow": "positive"}, "category": "<ignore rules>"}
    summary = await generate_digest_summary(client, model="test", facts=facts)
    assert summary == "Cash flow was positive and expenses were steady."
    assert r"\u003cignore rules\u003e" in messages.call["messages"][0]["content"]

    messages.response = SimpleNamespace(
        content=[
            SimpleNamespace(
                type="tool_use",
                name="write_weekly_summary",
                input={"summary": "Cash flow was up by 40 percent."},
            )
        ]
    )
    assert await generate_digest_summary(client, model="test", facts=facts) is None


def test_deterministic_fallback_and_email_render_include_computed_facts() -> None:
    facts = {
        "signals": {
            "activity": "transactions_recorded",
            "net_cash_flow": "positive",
            "outflows_trend": "decreased",
            "month_to_date_budget": "within_budget",
        },
        "current_week": {
            "inflows": "100.00",
            "outflows": "25.00",
            "net_cash_flow": "75.00",
            "transaction_count": 2,
        },
        "previous_week": {
            "start": "2026-10-19",
            "end": "2026-10-25",
            "inflows": "0.00",
            "outflows": "30.00",
            "net_cash_flow": "-30.00",
            "transaction_count": 1,
        },
        "top_expense_categories": {"items": [], "truncated": False},
        "month_to_date_budget": {
            "period": "2026-11",
            "through_date": "2026-11-01",
            "total_budgeted": "200.00",
            "total_actual": "25.00",
            "total_remaining": "175.00",
            "over_budget_count": 0,
            "items": [],
            "items_truncated": False,
        },
    }
    fallback = deterministic_digest_summary(facts)
    assert "positive net cash flow" in fallback
    body = render_digest_email(
        company_name="Test Co",
        period_start=date(2026, 10, 26),
        period_end=date(2026, 11, 1),
        summary=fallback,
        facts=facts,
    )
    assert "Inflows: 100.00" in body
    assert "Actual total: 25.00" in body
    assert "2026-10-26 through 2026-11-01" in body


def test_smtp_delivery_uses_starttls_and_sends_one_private_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pydantic import SecretStr

    from app.core.config import settings
    import app.services.weekly_digest as digest_service

    class FakeSMTP:
        def __init__(self, host: str, port: int, *, timeout: int) -> None:
            self.host = host
            self.port = port
            self.timeout = timeout
            self.started_tls = False
            self.credentials: tuple[str, str] | None = None
            self.message = None

        def __enter__(self) -> "FakeSMTP":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def starttls(self, *, context: object) -> None:
            self.started_tls = True

        def login(self, username: str, password: str) -> None:
            self.credentials = (username, password)

        def send_message(self, message: object) -> None:
            self.message = message

    fake = FakeSMTP("smtp.example.test", 587, timeout=15)
    monkeypatch.setattr(digest_service.smtplib, "SMTP", lambda *args, **kwargs: fake)
    monkeypatch.setattr(settings, "digest_smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "digest_smtp_port", 587)
    monkeypatch.setattr(settings, "digest_smtp_username", "smtp-user")
    monkeypatch.setattr(settings, "digest_smtp_password", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "digest_smtp_starttls", True)
    monkeypatch.setattr(settings, "digest_email_from", "reports@example.test")

    _send_email_sync(
        recipient="owner@example.test",
        subject="Weekly finance digest",
        body="Cash flow facts",
    )

    assert fake.started_tls is True
    assert fake.credentials == ("smtp-user", "test-secret")
    assert fake.message["To"] == "owner@example.test"
    assert fake.message["From"] == "reports@example.test"
    assert fake.message.get_content().strip() == "Cash flow facts"
