import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

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
