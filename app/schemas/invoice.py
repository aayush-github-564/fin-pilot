import uuid
from datetime import date as date_type
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class InvoiceCreate(BaseModel):
    vendor: str
    amount: Decimal
    date: date_type
    status: str = "pending"


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    vendor: str
    amount: Decimal
    date: date_type
    status: str


class InvoiceUpdate(BaseModel):
    vendor: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[date_type] = None
    status: Optional[str] = None
