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
    created = await async_client.post(
        "/api/v1/companies",
        headers=owner.headers,
        json={"name": "New Co", "currency_code": "inr"},
    )

    assert missing.status_code == 422
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
