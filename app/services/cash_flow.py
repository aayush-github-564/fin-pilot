"""Deterministic helpers for cash-flow and runway metrics."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

CENT = Decimal("0.01")
AVERAGE_DAYS_PER_MONTH = Decimal("30.436875")
Granularity = Literal["day", "month"]


def bucket_starts(
    start_date: date, end_date: date, granularity: Granularity
) -> list[date]:
    """Return every period start touched by an inclusive date range."""
    if granularity == "day":
        return [
            date.fromordinal(ordinal)
            for ordinal in range(start_date.toordinal(), end_date.toordinal() + 1)
        ]

    current = start_date.replace(day=1)
    final = end_date.replace(day=1)
    starts: list[date] = []
    while current <= final:
        starts.append(current)
        if current == final:
            break
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return starts


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def build_cash_flow_report(
    *,
    start_date: date,
    end_date: date,
    granularity: Granularity,
    grouped_rows: list[tuple[date, Decimal, Decimal, int]],
    cash_balance: Decimal | None,
) -> dict[str, object]:
    """Fill empty buckets and calculate summaries from SQL aggregate rows."""
    grouped = {
        period_start: (Decimal(inflows), Decimal(outflows), int(count))
        for period_start, inflows, outflows, count in grouped_rows
    }
    buckets = []
    for period_start in bucket_starts(start_date, end_date, granularity):
        inflows, outflows, count = grouped.get(
            period_start, (Decimal("0.00"), Decimal("0.00"), 0)
        )
        buckets.append(
            {
                "period_start": period_start,
                "inflows": inflows,
                "outflows": outflows,
                "net_cash_flow": inflows - outflows,
                "transaction_count": count,
            }
        )

    total_inflows = sum((bucket["inflows"] for bucket in buckets), Decimal("0.00"))
    total_outflows = sum((bucket["outflows"] for bucket in buckets), Decimal("0.00"))
    net_cash_flow = total_inflows - total_outflows
    inclusive_days = Decimal((end_date - start_date).days + 1)
    raw_monthly_outflow = total_outflows * AVERAGE_DAYS_PER_MONTH / inclusive_days
    raw_monthly_net_burn = (total_outflows - total_inflows) * (
        AVERAGE_DAYS_PER_MONTH / inclusive_days
    )

    runway_months = None
    if cash_balance is None:
        runway_status = "cash_balance_required"
    elif raw_monthly_net_burn <= 0:
        runway_status = "no_net_burn"
    else:
        runway_status = "estimated"
        runway_months = _money(cash_balance / raw_monthly_net_burn)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "granularity": granularity,
        "total_inflows": total_inflows,
        "total_outflows": total_outflows,
        "net_cash_flow": net_cash_flow,
        "transaction_count": sum(bucket["transaction_count"] for bucket in buckets),
        "average_monthly_outflow": _money(raw_monthly_outflow),
        "average_monthly_net_burn": _money(raw_monthly_net_burn),
        "cash_balance": cash_balance,
        "runway_months": runway_months,
        "runway_status": runway_status,
        "buckets": buckets,
    }
