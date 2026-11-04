import calendar
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Date, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.budget import Budget
from app.models.category import Category, CategoryKind
from app.models.company_member import CompanyMember
from app.models.transaction import Transaction
from app.schemas.metrics import BudgetVsActualRead, CashFlowMetricsRead
from app.services.cash_flow import build_cash_flow_report

router = APIRouter(prefix="/companies/{company_id}/metrics", tags=["metrics"])
MAX_RANGE_DAYS = 366
MAX_FINANCIAL_AMOUNT = Decimal("9999999999.99")
CENT = Decimal("0.01")


def _cash_flow_range(
    start_date: date | None, end_date: date | None
) -> tuple[date, date]:
    today_utc = datetime.now(UTC).date()
    resolved_end = end_date or today_utc
    default_start_ordinal = max(1, resolved_end.toordinal() - 364)
    resolved_start = start_date or date.fromordinal(default_start_ordinal)
    if resolved_end < resolved_start:
        raise HTTPException(
            status_code=422, detail="end_date must be on or after start_date"
        )
    if (resolved_end - resolved_start).days >= MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=422,
            detail="Date range cannot exceed 366 calendar days",
        )
    return resolved_start, resolved_end


@router.get("/cash-flow", response_model=CashFlowMetricsRead)
async def get_cash_flow_metrics(
    company_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    granularity: Literal["day", "month"] = "month",
    cash_balance: Decimal | None = Query(default=None, ge=0),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
) -> CashFlowMetricsRead:
    resolved_start, resolved_end = _cash_flow_range(start_date, end_date)
    if cash_balance is not None and (
        not cash_balance.is_finite()
        or cash_balance.as_tuple().exponent < -2
        or cash_balance > MAX_FINANCIAL_AMOUNT
    ):
        raise HTTPException(
            status_code=422,
            detail="cash_balance must fit the supported two-decimal currency precision",
        )

    period_start = (
        Transaction.date
        if granularity == "day"
        else func.date_trunc("month", Transaction.date).cast(Date)
    )
    inflows = func.sum(
        case((Transaction.amount > 0, Transaction.amount), else_=Decimal("0.00"))
    ).label("inflows")
    outflows = func.sum(
        case((Transaction.amount < 0, -Transaction.amount), else_=Decimal("0.00"))
    ).label("outflows")
    result = await db.execute(
        select(
            period_start.label("period_start"),
            inflows,
            outflows,
            func.count(Transaction.id).label("transaction_count"),
        )
        .where(
            Transaction.company_id == company_id,
            Transaction.date >= resolved_start,
            Transaction.date <= resolved_end,
        )
        .group_by(period_start)
        .order_by(period_start)
    )
    report = build_cash_flow_report(
        start_date=resolved_start,
        end_date=resolved_end,
        granularity=granularity,
        grouped_rows=[
            (row.period_start, row.inflows, row.outflows, row.transaction_count)
            for row in result
        ],
        cash_balance=cash_balance,
    )
    return CashFlowMetricsRead.model_validate(report)


@router.get("/budget-vs-actual", response_model=BudgetVsActualRead)
async def get_budget_vs_actual(
    company_id: UUID,
    period: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
) -> BudgetVsActualRead:
    try:
        period_start = date.fromisoformat(f"{period}-01")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="period must be a valid YYYY-MM month") from error
    period_end = date(
        period_start.year,
        period_start.month,
        calendar.monthrange(period_start.year, period_start.month)[1],
    )

    budget_result = await db.execute(
        select(
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            Category.kind.label("category_kind"),
            func.sum(Budget.limit_amount).label("budgeted_amount"),
        )
        .join(Category, Category.id == Budget.category_id)
        .where(
            Budget.company_id == company_id,
            Budget.period == period,
            (Category.company_id == company_id) | Category.company_id.is_(None),
        )
        .group_by(Category.id, Category.name, Category.kind)
        .order_by(Category.name, Category.id)
    )
    budget_rows = list(budget_result)
    category_ids = [row.category_id for row in budget_rows]
    actual_by_category: dict[UUID, tuple[Decimal, Decimal, int]] = {}
    if category_ids:
        actual_result = await db.execute(
            select(
                Transaction.category_id,
                func.sum(
                    case(
                        (Transaction.amount > 0, Transaction.amount),
                        else_=Decimal("0.00"),
                    )
                ).label("inflows"),
                func.sum(
                    case(
                        (Transaction.amount < 0, -Transaction.amount),
                        else_=Decimal("0.00"),
                    )
                ).label("outflows"),
                func.count(Transaction.id).label("transaction_count"),
            )
            .where(
                Transaction.company_id == company_id,
                Transaction.category_id.in_(category_ids),
                Transaction.date >= period_start,
                Transaction.date <= period_end,
            )
            .group_by(Transaction.category_id)
        )
        actual_by_category = {
            category_id: (inflows, outflows, count)
            for category_id, inflows, outflows, count in actual_result
        }

    items = []
    for row in budget_rows:
        inflows, outflows, transaction_count = actual_by_category.get(
            row.category_id, (Decimal("0.00"), Decimal("0.00"), 0)
        )
        actual_amount = (
            inflows if row.category_kind == CategoryKind.income else outflows
        )
        budgeted_amount = Decimal(row.budgeted_amount)
        utilization = (
            (actual_amount * Decimal("100") / budgeted_amount).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            if budgeted_amount > 0
            else None
        )
        items.append(
            {
                "category_id": row.category_id,
                "category_name": row.category_name,
                "category_kind": row.category_kind,
                "budgeted_amount": budgeted_amount,
                "actual_amount": actual_amount,
                "remaining_amount": budgeted_amount - actual_amount,
                "utilization_percent": utilization,
                "over_budget": actual_amount > budgeted_amount,
                "transaction_count": transaction_count,
            }
        )

    total_budgeted = sum(
        (item["budgeted_amount"] for item in items), Decimal("0.00")
    )
    total_actual = sum((item["actual_amount"] for item in items), Decimal("0.00"))
    return BudgetVsActualRead(
        period=period,
        total_budgeted=total_budgeted,
        total_actual=total_actual,
        total_remaining=total_budgeted - total_actual,
        items=items,
    )
