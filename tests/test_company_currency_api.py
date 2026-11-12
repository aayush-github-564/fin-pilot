from typing import Any

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_new_company_requires_and_normalizes_iso_currency_code(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")

    missing = await async_client.post(
        "/api/v1/companies", headers=owner.headers, json={"name": "New Co"}
    )
    invalid = await async_client.post(
        "/api/v1/companies",
        headers=owner.headers,
        json={"name": "New Co", "currency_code": "ZZZ"},
    )
    created = await async_client.post(
        "/api/v1/companies",
        headers=owner.headers,
        json={"name": "New Co", "currency_code": "inr"},
    )

    assert missing.status_code == 422
    assert invalid.status_code == 422
    assert created.status_code == 201, created.text
    assert created.json()["currency_code"] == "INR"


async def test_owner_can_set_legacy_currency_once_and_viewer_cannot_change_it(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    viewer = await actor_factory("viewer")
    url = f"/api/v1/companies/{owner.company_id}"

    set_currency = await async_client.patch(
        url, headers=owner.headers, json={"currency_code": "usd"}
    )
    change_currency = await async_client.patch(
        url, headers=owner.headers, json={"currency_code": "EUR"}
    )
    forbidden = await async_client.patch(
        f"/api/v1/companies/{viewer.company_id}",
        headers=viewer.headers,
        json={"currency_code": "INR"},
    )

    assert set_currency.status_code == 200
    assert set_currency.json()["currency_code"] == "USD"
    assert change_currency.status_code == 409
    assert forbidden.status_code == 403


async def test_legacy_company_currency_must_be_a_current_iso_4217_code(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    response = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}",
        headers=owner.headers,
        json={"currency_code": "DEM"},
    )
    assert response.status_code == 422


async def test_admin_can_edit_company_name_but_cannot_change_currency(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import CompanyMember, CompanyRole

    owner = await actor_factory("owner")
    admin = await actor_factory("accountant")
    async with AsyncSessionLocal() as session:
        session.add(CompanyMember(user_id=admin.user_id, company_id=owner.company_id, role=CompanyRole.accountant))
        await session.commit()

    name_change = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}",
        headers=admin.headers,
        json={"name": "Managed by admin"},
    )
    currency_change = await async_client.patch(
        f"/api/v1/companies/{owner.company_id}",
        headers=admin.headers,
        json={"currency_code": "USD"},
    )

    assert name_change.status_code == 200
    assert currency_change.status_code == 403
