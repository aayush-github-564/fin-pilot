from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_upload_requires_and_persists_invoice_direction(
    async_client: AsyncClient,
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await actor_factory("owner")

    async def fake_save_file(*args: Any, **kwargs: Any) -> str:
        return f"{owner.company_id}/stored.pdf"

    monkeypatch.setattr("app.api.routes.invoices.save_file", fake_save_file)
    url = f"/api/v1/companies/{owner.company_id}/invoices/upload"
    file = {"file": ("receipt.pdf", b"pdf bytes", "application/pdf")}

    missing_direction = await async_client.post(
        url, headers=owner.headers, files=file
    )
    uploaded = await async_client.post(
        url,
        headers=owner.headers,
        files=file,
        data={"direction": "purchase"},
    )

    assert missing_direction.status_code == 422
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["direction"] == "purchase"
    assert uploaded.json()["confirmed_at"] is None


async def test_invoice_confirmation_is_idempotent_and_does_not_create_cash_transaction(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Invoice, InvoiceDirection, Transaction

    owner = await actor_factory("owner")
    created = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invoices",
        headers=owner.headers,
        json={
            "direction": "sale",
            "vendor": "Customer A",
            "amount": "250.00",
            "date": "2026-04-03",
        },
    )
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]
    confirm_url = (
        f"/api/v1/companies/{owner.company_id}/invoices/{invoice_id}/confirm"
    )

    confirmed = await async_client.post(confirm_url, headers=owner.headers)
    repeated = await async_client.post(confirm_url, headers=owner.headers)

    assert confirmed.status_code == repeated.status_code == 200
    assert confirmed.json()["confirmed_at"] == repeated.json()["confirmed_at"]
    async with AsyncSessionLocal() as session:
        invoice = await session.get(Invoice, UUID(invoice_id))
        transactions = list(
            (
                await session.execute(
                    select(Transaction).where(
                        Transaction.company_id == owner.company_id
                    )
                )
            ).scalars()
        )
    assert invoice is not None
    assert invoice.direction == InvoiceDirection.sale
    assert invoice.confirmed_at is not None
    assert transactions == []


async def test_invoice_cannot_be_confirmed_before_extraction_or_without_required_fields(
    async_client: AsyncClient,
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Invoice, InvoiceDirection, ProcessingStatus

    owner = await actor_factory("owner")

    async def fake_save_file(*args: Any, **kwargs: Any) -> str:
        return f"{owner.company_id}/stored.pdf"

    monkeypatch.setattr("app.api.routes.invoices.save_file", fake_save_file)
    uploaded = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invoices/upload",
        headers=owner.headers,
        files={"file": ("receipt.pdf", b"pdf", "application/pdf")},
        data={"direction": "purchase"},
    )
    pending_confirmation = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invoices/"
        f"{uploaded.json()['id']}/confirm",
        headers=owner.headers,
    )

    async with AsyncSessionLocal() as session:
        invoice = await session.get(Invoice, UUID(uploaded.json()["id"]))
        invoice.processing_status = ProcessingStatus.complete
        invoice.direction = InvoiceDirection.purchase
        await session.commit()
    incomplete_confirmation = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invoices/"
        f"{uploaded.json()['id']}/confirm",
        headers=owner.headers,
    )

    assert pending_confirmation.status_code == 409
    assert incomplete_confirmation.status_code == 422
