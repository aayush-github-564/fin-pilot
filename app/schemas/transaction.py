import uuid
from datetime import date as date_type
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.transaction import TransactionSource


class TransactionCreate(BaseModel):
    date: date_type
    amount: Decimal = Field(max_digits=12, decimal_places=2)
    description: Optional[str]
    category_id: Optional[uuid.UUID] = None
    source: TransactionSource = TransactionSource.manual


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    date: date_type
    amount: Decimal
    description: Optional[str]
    category_id: Optional[uuid.UUID] = None
    source: TransactionSource


class TransactionUpdate(BaseModel):
    date: Optional[date_type] = None
    amount: Optional[Decimal] = Field(default=None, max_digits=12, decimal_places=2)
    description: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
