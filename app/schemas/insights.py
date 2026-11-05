from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SpendingAnomalyRead(BaseModel):
    transaction_id: UUID
    date: date
    description: str | None
    category_name: str | None
    comparison_basis: Literal["vendor", "category"]
    amount: Decimal
    baseline_average: Decimal
    baseline_transaction_count: int
    ratio_to_average: Decimal
    z_score: Decimal | None
    explanation: str
    explanation_source: Literal["llm", "deterministic"]


class SpendingAnomalyReportRead(BaseModel):
    window_start: date
    window_end: date
    baseline_start: date
    baseline_end: date
    scanned_transactions: int
    scan_truncated: bool
    anomalies_truncated: bool
    anomalies: list[SpendingAnomalyRead]
