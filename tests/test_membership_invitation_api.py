from __future__ import annotations

import hashlib
from typing import Any

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_invitation_stores_only_a_hash_and_accepts_verified_matching_email(
    async_client: AsyncClient,
    actor_factory: Any,
) -> None:
    from sqlalchemy import select

    from app.core.db import AsyncSessionLocal
    from app.models import CompanyInvitation, CompanyMember, CompanyRole

    owner = await actor_factory("owner")
    invitee = await actor_factory("member")
    email = invitee.email
    created = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invitations",
        headers=owner.headers,
        json={"email": email, "role": "member"},
    )
    assert created.status_code == 201
    body = created.json()
    token = body["invite_url"].rsplit("/", 1)[-1]

    async with AsyncSessionLocal() as session:
        invitation = await session.scalar(
            select(CompanyInvitation).where(CompanyInvitation.id == body["id"])
        )
        assert invitation is not None
        assert invitation.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in invitation.token_hash

    accepted = await async_client.post(
        f"/api/v1/invite/{token}/accept", headers=invitee.headers
    )
    assert accepted.status_code == 200
    assert accepted.json()["role"] == "member"

    repeated = await async_client.post(
        f"/api/v1/invite/{token}/accept", headers=invitee.headers
    )
    assert repeated.status_code == 200
    assert repeated.json()["already_member"] is True
    async with AsyncSessionLocal() as session:
        membership = await session.scalar(
            select(CompanyMember).where(
                CompanyMember.company_id == owner.company_id,
                CompanyMember.user_id == invitee.user_id,
            )
        )
        assert membership is not None
        assert membership.role == CompanyRole.member


async def test_admin_cannot_invite_owner_or_invite_existing_member(
    async_client: AsyncClient,
    actor_factory: Any,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import CompanyMember, CompanyRole, User

    owner = await actor_factory("owner")
    admin = await actor_factory("accountant")
    async with AsyncSessionLocal() as session:
        user = await session.get(User, admin.user_id)
        assert user is not None
        session.add(CompanyMember(user_id=user.id, company_id=owner.company_id, role=CompanyRole.accountant))
        await session.commit()

    owner_invite = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invitations",
        headers=admin.headers,
        json={"email": "new-owner@example.com", "role": "owner"},
    )
    assert owner_invite.status_code == 403

    existing_member = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/invitations",
        headers=admin.headers,
        json={"email": admin.email, "role": "member"},
    )
    assert existing_member.status_code == 409
