import uuid
from datetime import date as date_type
from decimal import Decimal
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
