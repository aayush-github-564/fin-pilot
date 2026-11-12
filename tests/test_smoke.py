from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health_returns_ok(async_client: AsyncClient) -> None:
    response = await async_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_legacy_auth_endpoints_are_removed(async_client: AsyncClient) -> None:
    assert (await async_client.post("/api/v1/auth/register", json={})).status_code == 404
    assert (await async_client.post("/api/v1/auth/login", json={})).status_code == 404


async def test_supabase_session_loads_application_user(
    async_client: AsyncClient,
    actor_factory: Any,
) -> None:
    actor = await actor_factory("owner")
    response = await async_client.get("/api/v1/auth/me", headers=actor.headers)

    assert response.status_code == 200
    assert response.json()["email"].endswith("@example.com")


async def test_supabase_login_does_not_claim_a_legacy_local_account(
    async_client: AsyncClient,
    register_test_token: Any,
) -> None:
    from uuid import uuid4

    from app.core.db import AsyncSessionLocal
    from app.models import User

    legacy_email = "legacy.owner@example.com"
    async with AsyncSessionLocal() as session:
        legacy = User(email=legacy_email, hashed_password="legacy-hash")
        session.add(legacy)
        await session.commit()

    token = register_test_token({
        "sub": str(uuid4()),
        "email": legacy_email,
        "email_verified": True,
        "user_metadata": {"full_name": "New Identity"},
    })
    response = await async_client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 409


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
