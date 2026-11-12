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


async def test_member_can_upload_invoice_and_categorize_but_not_manage_transactions(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from datetime import date
    from decimal import Decimal

    from app.core.db import AsyncSessionLocal
    from app.models import Category, Transaction, TransactionSource

    member = await actor_factory("member")
    invoice = await async_client.post(
        f"/api/v1/companies/{member.company_id}/invoices",
        headers=member.headers,
        json={
            "direction": "purchase",
            "vendor": "Stationery",
            "amount": "28.50",
            "date": "2026-11-01",
        },
    )
    assert invoice.status_code == 201

    async with AsyncSessionLocal() as session:
        category = Category(company_id=member.company_id, name="Office supplies")
        session.add(category)
        await session.flush()
        transaction = Transaction(
            company_id=member.company_id,
            date=date(2026, 11, 1),
            amount=Decimal("-28.50"),
            description="Stationery",
            source=TransactionSource.manual,
        )
        session.add(transaction)
        await session.commit()
        category_id = category.id
        transaction_id = transaction.id

    categorized = await async_client.patch(
        f"/api/v1/companies/{member.company_id}/transactions/{transaction_id}",
        headers=member.headers,
        json={"category_id": str(category_id)},
    )
    created_transaction = await async_client.post(
        f"/api/v1/companies/{member.company_id}/transactions",
        headers=member.headers,
        json={"date": "2026-11-02", "amount": "-2.00", "description": "Other"},
    )

    assert categorized.status_code == 200
    assert categorized.json()["category_id"] == str(category_id)
    assert created_transaction.status_code == 403


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


async def test_viewer_cannot_patch_or_delete_company_resources(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from datetime import date
    from decimal import Decimal

    from app.core.db import AsyncSessionLocal
    from app.models import (
        Budget,
        Category,
        CompanyMember,
        CompanyRole,
        Invoice,
        InvoiceDirection,
        InvoiceStatus,
        ProcessingStatus,
        Transaction,
        TransactionSource,
    )

    owner = await actor_factory("owner")
    viewer = await actor_factory("viewer")
    async with AsyncSessionLocal() as session:
        session.add(
            CompanyMember(
                user_id=viewer.user_id,
                company_id=owner.company_id,
                role=CompanyRole.viewer,
            )
        )
        category = Category(company_id=owner.company_id, name="Test expense")
        session.add(category)
        await session.flush()
        transaction = Transaction(
            company_id=owner.company_id,
            date=date(2026, 1, 2),
            amount=Decimal("-10.00"),
            description="Meal",
            category_id=category.id,
            source=TransactionSource.manual,
        )
        invoice = Invoice(
            company_id=owner.company_id,
            direction=InvoiceDirection.purchase,
            vendor="Vendor",
            amount=Decimal("10.00"),
            date=date(2026, 1, 2),
            status=InvoiceStatus.pending,
            processing_status=ProcessingStatus.complete,
        )
        budget = Budget(
            company_id=owner.company_id,
            category_id=category.id,
            period="2026-01",
            limit_amount=Decimal("100.00"),
        )
        session.add_all([transaction, invoice, budget])
        await session.commit()
        transaction_id = transaction.id
        invoice_id = invoice.id
        budget_id = budget.id
        category_id = category.id

    root = f"/api/v1/companies/{owner.company_id}"
    writes = [
        ("PATCH", f"/api/v1/companies/{owner.company_id}", {"name": "Changed"}),
        ("PATCH", f"{root}/transactions/{transaction_id}", {"description": "Changed"}),
        ("PATCH", f"{root}/invoices/{invoice_id}", {"status": "paid"}),
        ("PATCH", f"{root}/budgets/{budget_id}", {"limit_amount": "200.00"}),
        ("PATCH", f"{root}/categories/{category_id}", {"name": "Changed"}),
        ("DELETE", f"/api/v1/companies/{owner.company_id}", None),
        ("DELETE", f"{root}/transactions/{transaction_id}", None),
        ("DELETE", f"{root}/invoices/{invoice_id}", None),
        ("DELETE", f"{root}/budgets/{budget_id}", None),
        ("DELETE", f"{root}/categories/{category_id}", None),
    ]
    for method, url, payload in writes:
        response = await async_client.request(
            method,
            url,
            headers=viewer.headers,
            json=payload,
        )
        assert response.status_code == 403, f"{method} {url}: {response.text}"


async def test_global_categories_cannot_be_edited_or_deleted(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import Category

    owner = await actor_factory("owner")
    async with AsyncSessionLocal() as session:
        category = Category(company_id=None, name="Global category")
        session.add(category)
        await session.commit()
        category_id = category.id

    url = f"/api/v1/companies/{owner.company_id}/categories/{category_id}"
    patched = await async_client.patch(
        url, headers=owner.headers, json={"name": "Changed"}
    )
    deleted = await async_client.delete(url, headers=owner.headers)
    assert patched.status_code == deleted.status_code == 404
