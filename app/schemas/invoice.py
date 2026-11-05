import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

from app.models.invoice import InvoiceDirection, InvoiceStatus


class InvoiceCreate(BaseModel):
    direction: InvoiceDirection
    vendor: str
    amount: Decimal = Field(max_digits=12, decimal_places=2)
    date: date_type
    status: InvoiceStatus = InvoiceStatus.pending


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    direction: InvoiceDirection | None = None
    vendor: Optional[str] = None
    amount: Optional[Decimal] = None
    date: Optional[date_type] = None
    status: InvoiceStatus
    processing_status: str
    confirmed_at: datetime | None = None
    file_reference: Optional[str] = None


class InvoiceUpdate(BaseModel):
    direction: InvoiceDirection | None = None
    vendor: Optional[str] = None
    amount: Optional[Decimal] = Field(default=None, max_digits=12, decimal_places=2)
    date: Optional[date_type] = None
    status: InvoiceStatus | SkipJsonSchema[None] = None

    @field_validator("status")
    @classmethod
    def status_cannot_be_null(
        cls, value: InvoiceStatus | None
    ) -> InvoiceStatus | None:
        if value is None:
            raise ValueError("status cannot be null")
        return value
