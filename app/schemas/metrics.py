from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.models.category import CategoryKind


class InvoiceDocumentCountsRead(BaseModel):
    total: int
    processing: int
    awaiting_review: int
    confirmed: int
    failed: int


class CashFlowBucketRead(BaseModel):
    period_start: date
    inflows: Decimal
    outflows: Decimal
    net_cash_flow: Decimal
    transaction_count: int


class CashFlowMetricsRead(BaseModel):
    start_date: date
    end_date: date
    granularity: Literal["day", "month"]
    total_inflows: Decimal
    total_outflows: Decimal
    net_cash_flow: Decimal
    transaction_count: int
    average_monthly_outflow: Decimal
    average_monthly_net_burn: Decimal
    cash_balance: Decimal | None
    runway_months: Decimal | None
    runway_status: Literal["cash_balance_required", "no_net_burn", "estimated"]
    buckets: list[CashFlowBucketRead]


class BudgetVsActualItemRead(BaseModel):
    category_id: UUID
    category_name: str
    category_kind: CategoryKind
    budgeted_amount: Decimal
    actual_amount: Decimal
    remaining_amount: Decimal
    utilization_percent: Decimal | None
    over_budget: bool
    transaction_count: int


class BudgetVsActualRead(BaseModel):
    period: str
    total_budgeted: Decimal
    total_actual: Decimal
    total_remaining: Decimal
    items: list[BudgetVsActualItemRead]
