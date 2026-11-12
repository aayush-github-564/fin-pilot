from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.company_member import CompanyRole


class InvitationCreate(BaseModel):
    email: EmailStr
    role: CompanyRole


class InvitationRead(BaseModel):
    id: UUID
    company_id: UUID
    company_name: str | None = None
    email: EmailStr
    role: CompanyRole
    status: str
    invited_by_name: str | None = None
    created_at: datetime
    expires_at: datetime


class InvitationCreated(InvitationRead):
    invite_url: str
    email_queued: bool
    email_configured: bool


class InvitationPreview(BaseModel):
    company_name: str
    role: CompanyRole
    inviter_name: str | None
    invited_email: EmailStr
    status: str


class MemberRead(BaseModel):
    user_id: UUID
    full_name: str | None
    email: EmailStr
    role: CompanyRole
    joined_at: datetime


class MemberRoleUpdate(BaseModel):
    role: CompanyRole


class MembershipEventRead(BaseModel):
    id: UUID
    event_type: str
    actor_name: str | None
    target_name: str | None
    target_email: EmailStr | None
    before_role: CompanyRole | None
    after_role: CompanyRole | None
    created_at: datetime


class InvitationAcceptRead(BaseModel):
    company_id: UUID
    role: CompanyRole
    already_member: bool = False
