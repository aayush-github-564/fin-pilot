import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.company_member import CompanyRole


class CompanyCreate(BaseModel):
    name: str


class CompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: datetime


class CompanyMembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    role: CompanyRole


class CompanyUpdate(BaseModel):
    name: Optional[str] = None


class MemberInvite(BaseModel):
    email: EmailStr
    role: str  # "owner" | "accountant" | "viewer"


class MemberOut(BaseModel):
    id: UUID
    user_id: UUID
    company_id: UUID
    role: str

    class Config:
        from_attributes = True
