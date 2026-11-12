from datetime import UTC, datetime, timedelta
from hashlib import sha256
import logging
import secrets
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_arq_redis,
    get_current_company_member,
    get_current_user,
    get_db,
    get_verified_token_claims,
    require_permission,
)
from app.core.config import settings
from app.core.permissions import Permission, role_can_grant
from app.models import Company, CompanyInvitation, CompanyMember, CompanyRole, MembershipEvent, User
from app.schemas.membership import (
    InvitationAcceptRead,
    InvitationCreate,
    InvitationCreated,
    InvitationPreview,
    InvitationRead,
    MemberRead,
    MemberRoleUpdate,
    MembershipEventRead,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["memberships"])
INVITATION_LIFETIME = timedelta(days=7)


def _token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _verified_email_claim(claims: dict[str, object]) -> bool:
    if claims.get("email_verified") is False:
        return False
    metadata = claims.get("user_metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    confirmed_at = claims.get("email_confirmed_at")
    return (
        claims.get("email_verified") is True
        or metadata.get("email_verified") is True
        or (isinstance(confirmed_at, str) and bool(confirmed_at.strip()))
    )


async def _write_event(
    db: AsyncSession,
    *,
    company_id: UUID,
    event_type: str,
    actor: User,
    target_user_id: UUID | None = None,
    target_email: str | None = None,
    before_role: CompanyRole | None = None,
    after_role: CompanyRole | None = None,
) -> None:
    db.add(MembershipEvent(
        company_id=company_id,
        event_type=event_type,
        actor_id=actor.id,
        target_user_id=target_user_id,
        target_email=target_email,
        before_role=before_role,
        after_role=after_role,
    ))


async def _invitation_read(db: AsyncSession, invitation: CompanyInvitation) -> InvitationRead:
    company = await db.get(Company, invitation.company_id)
    inviter = await db.get(User, invitation.invited_by)
    return InvitationRead(
        id=invitation.id,
        company_id=invitation.company_id,
        company_name=company.name if company else None,
        email=invitation.email,
        role=invitation.role,
        status=(
            "expired"
            if invitation.status == "pending" and invitation.expires_at <= datetime.now(UTC)
            else invitation.status
        ),
        invited_by_name=inviter.full_name if inviter else None,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
    )


async def _queue_invitation_email(
    redis: ArqRedis,
    *,
    email: str,
    company_name: str,
    role: CompanyRole,
    inviter_name: str,
    invite_url: str,
) -> tuple[bool, bool]:
    configured = bool(settings.smtp_host and settings.smtp_from)
    if not configured:
        logger.info("Invitation email skipped because SMTP is not configured")
        return False, False
    try:
        await redis.enqueue_job(
            "send_company_invitation",
            email,
            company_name,
            role.value,
            inviter_name,
            invite_url,
        )
        return True, True
    except Exception as error:
        logger.error("Could not queue company invitation email", extra={"error_type": type(error).__name__})
        return False, True


def _created_response(
    invitation: InvitationRead,
    *,
    invite_url: str,
    email_queued: bool,
    email_configured: bool,
) -> InvitationCreated:
    return InvitationCreated(
        **invitation.model_dump(),
        invite_url=invite_url,
        email_queued=email_queued,
        email_configured=email_configured,
    )


@router.post(
    "/companies/{company_id}/invitations",
    response_model=InvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    company_id: UUID,
    payload: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
    member: CompanyMember = Depends(require_permission(Permission.members_manage)),
    actor: User = Depends(get_current_user),
):
    if not role_can_grant(member.role, payload.role):
        raise HTTPException(status_code=403, detail="You cannot invite someone at that access level")
    email = str(payload.email).strip().casefold()
    existing_member = await db.scalar(
        select(CompanyMember.id)
        .join(User, User.id == CompanyMember.user_id)
        .where(CompanyMember.company_id == company_id, func.lower(User.email) == email)
    )
    if existing_member is not None:
        raise HTTPException(status_code=409, detail="This person is already a company member")

    pending = await db.scalar(
        select(CompanyInvitation)
        .where(
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.email == email,
            CompanyInvitation.status == "pending",
        )
        .with_for_update()
    )
    now = datetime.now(UTC)
    if pending and pending.expires_at > now:
        raise HTTPException(status_code=409, detail="A pending invitation already exists for this email")
    if pending:
        pending.status = "expired"
        await db.flush()

    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    token = secrets.token_urlsafe(32)
    invitation = CompanyInvitation(
        company_id=company_id,
        email=email,
        role=payload.role,
        token_hash=_token_hash(token),
        invited_by=actor.id,
        status="pending",
        expires_at=now + INVITATION_LIFETIME,
    )
    db.add(invitation)
    await _write_event(
        db, company_id=company_id, event_type="invited", actor=actor,
        target_email=email, after_role=payload.role,
    )
    await db.commit()
    await db.refresh(invitation)
    invite_url = f"{settings.app_public_url.rstrip('/')}/invite/{token}"
    email_queued, email_configured = await _queue_invitation_email(
        redis,
        email=email,
        company_name=company.name,
        role=payload.role,
        inviter_name=actor.full_name or actor.email,
        invite_url=invite_url,
    )
    return _created_response(
        await _invitation_read(db, invitation),
        invite_url=invite_url,
        email_queued=email_queued,
        email_configured=email_configured,
    )


@router.get("/companies/{company_id}/invitations", response_model=list[InvitationRead])
async def list_invitations(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    _member: CompanyMember = Depends(require_permission(Permission.members_manage)),
):
    result = await db.execute(
        select(CompanyInvitation)
        .where(
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.status == "pending",
        )
        .order_by(CompanyInvitation.created_at.desc())
    )
    return [await _invitation_read(db, item) for item in result.scalars()]


@router.post(
    "/companies/{company_id}/invitations/{invitation_id}/resend",
    response_model=InvitationCreated,
)
async def resend_invitation(
    company_id: UUID,
    invitation_id: UUID,
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
    member: CompanyMember = Depends(require_permission(Permission.members_manage)),
    actor: User = Depends(get_current_user),
):
    invitation = await db.scalar(
        select(CompanyInvitation)
        .where(
            CompanyInvitation.id == invitation_id,
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.status.in_(["pending", "expired"]),
        )
        .with_for_update()
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not role_can_grant(member.role, invitation.role):
        raise HTTPException(status_code=403, detail="You cannot resend this invitation")
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    invitation.token_hash = _token_hash(token)
    invitation.status = "pending"
    invitation.expires_at = now + INVITATION_LIFETIME
    await _write_event(
        db,
        company_id=company_id,
        event_type="invitation_resent",
        actor=actor,
        target_email=invitation.email,
        before_role=invitation.role,
        after_role=invitation.role,
    )
    await db.commit()
    await db.refresh(invitation)
    company = await db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    email_queued, email_configured = await _queue_invitation_email(
        redis,
        email=invitation.email,
        company_name=company.name,
        role=invitation.role,
        inviter_name=actor.full_name or actor.email,
        invite_url=f"{settings.app_public_url.rstrip('/')}/invite/{token}",
    )
    return _created_response(
        await _invitation_read(db, invitation),
        invite_url=f"{settings.app_public_url.rstrip('/')}/invite/{token}",
        email_queued=email_queued,
        email_configured=email_configured,
    )


@router.delete("/companies/{company_id}/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    company_id: UUID,
    invitation_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.members_manage)),
    actor: User = Depends(get_current_user),
):
    invitation = await db.scalar(
        select(CompanyInvitation)
        .where(
            CompanyInvitation.id == invitation_id,
            CompanyInvitation.company_id == company_id,
            CompanyInvitation.status == "pending",
        )
        .with_for_update()
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Pending invitation not found")
    if not role_can_grant(member.role, invitation.role):
        raise HTTPException(status_code=403, detail="You cannot revoke this invitation")
    invitation.status = "revoked"
    await _write_event(
        db,
        company_id=company_id,
        event_type="revoked",
        actor=actor,
        target_email=invitation.email,
        before_role=invitation.role,
    )
    await db.commit()
    return None


@router.get("/invite/{token}", response_model=InvitationPreview)
async def preview_invitation(token: str, db: AsyncSession = Depends(get_db)):
    invitation = await db.scalar(
        select(CompanyInvitation).where(CompanyInvitation.token_hash == _token_hash(token))
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    preview_status = invitation.status
    if preview_status == "pending" and invitation.expires_at <= datetime.now(UTC):
        preview_status = "expired"
    company = await db.get(Company, invitation.company_id)
    inviter = await db.get(User, invitation.invited_by)
    return InvitationPreview(
        company_name=company.name if company else "Company unavailable",
        role=invitation.role,
        inviter_name=inviter.full_name if inviter else None,
        invited_email=invitation.email,
        status=preview_status,
    )


async def _accept_invitation_record(
    db: AsyncSession,
    invitation: CompanyInvitation,
    *,
    actor: User,
    claims: dict[str, object],
) -> InvitationAcceptRead:
    existing = await db.scalar(
        select(CompanyMember).where(
            CompanyMember.company_id == invitation.company_id,
            CompanyMember.user_id == actor.id,
        )
    )
    if invitation.status == "accepted" and existing is not None:
        return InvitationAcceptRead(
            company_id=invitation.company_id, role=existing.role, already_member=True
        )
    if invitation.status != "pending":
        raise HTTPException(status_code=410, detail="This invitation is no longer active")
    if invitation.expires_at <= datetime.now(UTC):
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(status_code=410, detail="This invitation has expired")
    if not _verified_email_claim(claims):
        raise HTTPException(status_code=403, detail="Verify your email before accepting an invitation")
    if actor.email.casefold() != invitation.email.casefold():
        raise HTTPException(
            status_code=403,
            detail=f"This invitation is for {invitation.email}; you are signed in as {actor.email}.",
        )
    if existing is None:
        existing = CompanyMember(
            user_id=actor.id,
            company_id=invitation.company_id,
            role=invitation.role,
        )
        db.add(existing)
    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(UTC)
    invitation.accepted_by = actor.id
    await _write_event(
        db,
        company_id=invitation.company_id,
        event_type="accepted",
        actor=actor,
        target_user_id=actor.id,
        target_email=actor.email,
        after_role=invitation.role,
    )
    await db.commit()
    return InvitationAcceptRead(company_id=invitation.company_id, role=invitation.role)


@router.post("/invite/{token}/accept", response_model=InvitationAcceptRead)
async def accept_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    claims: dict[str, object] = Depends(get_verified_token_claims),
):
    invitation = await db.scalar(
        select(CompanyInvitation)
        .where(CompanyInvitation.token_hash == _token_hash(token))
        .with_for_update()
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return await _accept_invitation_record(db, invitation, actor=actor, claims=claims)


@router.post("/invitations/{invitation_id}/accept", response_model=InvitationAcceptRead)
async def accept_my_invitation(
    invitation_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    claims: dict[str, object] = Depends(get_verified_token_claims),
):
    invitation = await db.scalar(
        select(CompanyInvitation)
        .where(CompanyInvitation.id == invitation_id)
        .with_for_update()
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.email.casefold() != actor.email.casefold():
        raise HTTPException(status_code=403, detail="This invitation is addressed to another email")
    return await _accept_invitation_record(db, invitation, actor=actor, claims=claims)


@router.get("/invitations/mine", response_model=list[InvitationRead])
async def list_my_invitations(
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CompanyInvitation)
        .where(
            CompanyInvitation.email == actor.email.casefold(),
            CompanyInvitation.status == "pending",
            CompanyInvitation.expires_at > datetime.now(UTC),
        )
        .order_by(CompanyInvitation.created_at.desc())
    )
    return [await _invitation_read(db, item) for item in result.scalars()]


@router.get("/companies/{company_id}/members", response_model=list[MemberRead])
async def list_members(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    _member: CompanyMember = Depends(require_permission(Permission.members_manage)),
):
    result = await db.execute(
        select(CompanyMember, User)
        .join(User, User.id == CompanyMember.user_id)
        .where(CompanyMember.company_id == company_id)
        .order_by(CompanyMember.created_at, User.email)
    )
    return [
        MemberRead(
            user_id=member.user_id,
            full_name=user.full_name,
            email=user.email,
            role=member.role,
            joined_at=member.created_at,
        )
        for member, user in result
    ]


async def _owner_count(db: AsyncSession, company_id: UUID) -> int:
    count = await db.scalar(
        select(func.count(CompanyMember.id)).where(
            CompanyMember.company_id == company_id,
            CompanyMember.role == CompanyRole.owner,
        )
    )
    return int(count or 0)


@router.patch("/companies/{company_id}/members/{user_id}", response_model=MemberRead)
async def change_member_role(
    company_id: UUID,
    user_id: UUID,
    payload: MemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    actor_member: CompanyMember = Depends(require_permission(Permission.members_manage)),
    actor: User = Depends(get_current_user),
):
    company = await db.scalar(
        select(Company).where(Company.id == company_id).with_for_update()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    target = await db.scalar(
        select(CompanyMember)
        .where(CompanyMember.company_id == company_id, CompanyMember.user_id == user_id)
        .with_for_update()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Company member not found")
    if not role_can_grant(actor_member.role, payload.role):
        raise HTTPException(status_code=403, detail="You cannot grant that access level")
    if actor_member.role != CompanyRole.owner and target.role == CompanyRole.owner:
        raise HTTPException(status_code=403, detail="Admins cannot modify an Owner")
    if target.role == CompanyRole.owner and payload.role != CompanyRole.owner:
        if await _owner_count(db, company_id) <= 1:
            raise HTTPException(status_code=409, detail="The last Owner cannot be demoted")
    before_role = target.role
    target.role = payload.role
    user = await db.get(User, user_id)
    await _write_event(
        db,
        company_id=company_id,
        event_type="role_changed",
        actor=actor,
        target_user_id=user_id,
        target_email=user.email if user else None,
        before_role=before_role,
        after_role=payload.role,
    )
    await db.commit()
    if user is None:
        raise HTTPException(status_code=404, detail="Company member not found")
    return MemberRead(
        user_id=user_id,
        full_name=user.full_name,
        email=user.email,
        role=target.role,
        joined_at=target.created_at,
    )


@router.delete("/companies/{company_id}/members/{user_id}", status_code=204)
async def remove_member(
    company_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor_member: CompanyMember = Depends(require_permission(Permission.members_manage)),
    actor: User = Depends(get_current_user),
):
    company = await db.scalar(
        select(Company).where(Company.id == company_id).with_for_update()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    target = await db.scalar(
        select(CompanyMember)
        .where(CompanyMember.company_id == company_id, CompanyMember.user_id == user_id)
        .with_for_update()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Company member not found")
    if user_id == actor.id:
        raise HTTPException(status_code=409, detail="Use the leave company action to remove yourself")
    if actor_member.role != CompanyRole.owner and target.role == CompanyRole.owner:
        raise HTTPException(status_code=403, detail="Admins cannot remove an Owner")
    if target.role == CompanyRole.owner and await _owner_count(db, company_id) <= 1:
        raise HTTPException(status_code=409, detail="The last Owner cannot be removed")
    user = await db.get(User, user_id)
    await _write_event(
        db,
        company_id=company_id,
        event_type="removed",
        actor=actor,
        target_user_id=user_id,
        target_email=user.email if user else None,
        before_role=target.role,
    )
    await db.delete(target)
    await db.commit()
    return None


@router.delete("/companies/{company_id}/members/me", status_code=204)
async def leave_company(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
    actor: User = Depends(get_current_user),
):
    await db.scalar(select(Company).where(Company.id == company_id).with_for_update())
    if member.role == CompanyRole.owner and await _owner_count(db, company_id) <= 1:
        raise HTTPException(status_code=409, detail="The last Owner cannot leave this company")
    await _write_event(
        db,
        company_id=company_id,
        event_type="left",
        actor=actor,
        target_user_id=actor.id,
        target_email=actor.email,
        before_role=member.role,
    )
    await db.delete(member)
    await db.commit()
    return None


@router.get("/companies/{company_id}/membership-events", response_model=list[MembershipEventRead])
async def list_membership_events(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    _member: CompanyMember = Depends(require_permission(Permission.members_manage)),
):
    from sqlalchemy.orm import aliased

    actor_user = aliased(User)
    target_user = aliased(User)
    result = await db.execute(
        select(MembershipEvent, actor_user, target_user)
        .join(actor_user, actor_user.id == MembershipEvent.actor_id)
        .outerjoin(target_user, target_user.id == MembershipEvent.target_user_id)
        .where(MembershipEvent.company_id == company_id)
        .order_by(MembershipEvent.created_at.desc(), MembershipEvent.id.desc())
        .limit(100)
    )
    return [
        MembershipEventRead(
            id=event.id,
            event_type=event.event_type,
            actor_name=actor.full_name or actor.email,
            target_name=target.full_name if target else None,
            target_email=event.target_email or (target.email if target else None),
            before_role=event.before_role,
            after_role=event.after_role,
            created_at=event.created_at,
        )
        for event, actor, target in result
    ]
