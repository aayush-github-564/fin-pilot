import uuid
from datetime import date as date_type
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.transaction import (
    CategorizationSource,
    CategorizationStatus,
    TransactionSource,
)


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
    categorization_status: CategorizationStatus
    categorization_source: CategorizationSource | None
    suggested_category_id: uuid.UUID | None
    suggestion_confidence: Decimal | None


class CSVImportRowRead(BaseModel):
    row_number: int
    status: Literal["imported", "duplicate", "rejected"]
    transaction_id: uuid.UUID | None = None
    categorization_status: CategorizationStatus | None = None
    error_code: str | None = None
    error_message: str | None = None


class CSVImportRead(BaseModel):
    rows_seen: int
    imported_count: int
    duplicate_count: int
    rejected_count: int
    rows: list[CSVImportRowRead]


class TransactionUpdate(BaseModel):
    date: Optional[date_type] = None
    amount: Optional[Decimal] = Field(default=None, max_digits=12, decimal_places=2)
    description: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
