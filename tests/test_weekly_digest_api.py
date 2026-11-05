from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_digest(company_id: UUID, period_start: date) -> UUID:
    from datetime import timedelta

    from app.core.db import AsyncSessionLocal
    from app.models import WeeklyDigest

    async with AsyncSessionLocal() as session:
        digest = WeeklyDigest(
            company_id=company_id,
            period_start=period_start,
            period_end=period_start + timedelta(days=6),
            facts={"current_week": {"net_cash_flow": "12.00"}},
            summary="The period ended with positive net cash flow.",
            summary_source="deterministic",
        )
        session.add(digest)
        await session.commit()
        return digest.id


async def test_member_can_read_latest_or_selected_digest_and_own_delivery_status(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import WeeklyDigestDelivery

    owner = await actor_factory("owner")
    first_id = await _create_digest(owner.company_id, date(2026, 10, 19))
    second_id = await _create_digest(owner.company_id, date(2026, 10, 26))
    async with AsyncSessionLocal() as session:
        session.add(
            WeeklyDigestDelivery(
                digest_id=second_id,
                user_id=owner.user_id,
                email_address="owner@example.com",
                status="sent",
            )
        )
        await session.commit()

    base_url = f"/api/v1/companies/{owner.company_id}/digests/weekly"
    latest = await async_client.get(base_url, headers=owner.headers)
    selected = await async_client.get(
        base_url,
        headers=owner.headers,
        params={"period_start": "2026-10-19"},
    )
    assert latest.status_code == selected.status_code == 200
    assert latest.json()["id"] == str(second_id)
    assert latest.json()["delivery_status"] == "sent"
    assert selected.json()["id"] == str(first_id)
    assert selected.json()["delivery_status"] is None


async def test_digest_read_is_tenant_scoped_and_period_must_be_monday(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    stranger = await actor_factory("viewer")
    base_url = f"/api/v1/companies/{owner.company_id}/digests/weekly"
    forbidden = await async_client.get(base_url, headers=stranger.headers)
    missing = await async_client.get(base_url, headers=owner.headers)
    invalid = await async_client.get(
        base_url, headers=owner.headers, params={"period_start": "2026-10-20"}
    )
    assert forbidden.status_code == 403
    assert missing.status_code == 404
    assert invalid.status_code == 422
