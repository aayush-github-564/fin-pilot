from typing import Any

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_company_list_includes_callers_role_and_only_their_companies(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    viewer = await actor_factory("viewer")

    owner_response = await async_client.get("/api/v1/companies", headers=owner.headers)
    viewer_response = await async_client.get(
        "/api/v1/companies", headers=viewer.headers
    )

    assert owner_response.status_code == viewer_response.status_code == 200
    owner_companies = owner_response.json()
    viewer_companies = viewer_response.json()
    assert owner_companies == [
        {
            "company_id": str(owner.company_id),
            "name": "Test company for owner",
            "currency_code": None,
            "created_at": owner_companies[0]["created_at"],
            "role": "owner",
        }
    ]
    assert viewer_companies == [
        {
            "company_id": str(viewer.company_id),
            "name": "Test company for viewer",
            "currency_code": None,
            "created_at": viewer_companies[0]["created_at"],
            "role": "viewer",
        }
    ]


async def test_company_me_returns_current_membership_and_rejects_non_members(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    outsider = await actor_factory("viewer")

    response = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/me", headers=owner.headers
    )
    forbidden = await async_client.get(
        f"/api/v1/companies/{owner.company_id}/me", headers=outsider.headers
    )

    assert response.status_code == 200
    assert response.json()["company_id"] == str(owner.company_id)
    assert response.json()["role"] == "owner"
    assert forbidden.status_code == 403
