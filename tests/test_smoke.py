from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health_returns_ok(async_client: AsyncClient) -> None:
    response = await async_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_register_then_login_returns_token(async_client: AsyncClient) -> None:
    credentials = {
        "email": "smoke.user@example.com",
        "password": "SafeSmokePassword123!",
    }
    registration = await async_client.post("/api/v1/auth/register", json=credentials)
    login = await async_client.post(
        "/api/v1/auth/login",
        data={"username": credentials["email"], "password": credentials["password"]},
    )

    assert registration.status_code == 201
    assert login.status_code == 200
    assert login.json()["access_token"]


async def test_viewer_cannot_patch_transaction(
    async_client: AsyncClient,
    actor_factory: Any,
    transaction_factory: Any,
) -> None:
    viewer = await actor_factory("viewer")
    transaction_id = await transaction_factory(viewer)

    response = await async_client.patch(
        f"/api/v1/companies/{viewer.company_id}/transactions/{transaction_id}",
        headers=viewer.headers,
        json={"description": "Viewer edit attempt"},
    )

    assert response.status_code == 403
