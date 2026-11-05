import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

import pycountry
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.company_member import CompanyRole


class CompanyCreate(BaseModel):
    name: str
    currency_code: str = Field(pattern=r"^[A-Za-z]{3}$")

    @field_validator("currency_code")
    @classmethod
    def normalize_currency_code(cls, value: str) -> str:
        return _normalize_currency_code(value)


class CompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    currency_code: str | None
    created_at: datetime


class CompanyMembershipRead(BaseModel):
    company_id: uuid.UUID
    name: str
    currency_code: str | None
    created_at: datetime
    role: CompanyRole


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    currency_code: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$")

    @field_validator("currency_code")
    @classmethod
    def normalize_currency_code(cls, value: str | None) -> str | None:
        return _normalize_currency_code(value) if value is not None else value


def _normalize_currency_code(value: str) -> str:
    normalized = value.upper()
    currency = pycountry.currencies.get(alpha_3=normalized)
    if currency is None or getattr(currency, "withdrawal_date", None) is not None:
        raise ValueError("currency_code must be a current ISO 4217 code")
    return normalized


class MemberInvite(BaseModel):
    email: EmailStr
    role: CompanyRole


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    company_id: UUID
    role: CompanyRole
