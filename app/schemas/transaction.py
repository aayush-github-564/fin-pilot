import uuid
from datetime import date as date_type
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class TransactionCreate(BaseModel):
    date: date_type
    amount: Decimal
    description: str
    category_id: uuid.UUID
    source: str = "manual"


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    date: date_type
    amount: Decimal
    description: str
    category_id: uuid.UUID
    source: str


class TransactionUpdate(BaseModel):
    date: Optional[date_type] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
