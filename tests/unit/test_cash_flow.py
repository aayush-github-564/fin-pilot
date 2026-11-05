from datetime import date
from decimal import Decimal

from app.services.cash_flow import bucket_starts, build_cash_flow_report


def test_month_buckets_cover_partial_months_and_empty_periods() -> None:
    assert bucket_starts(
        date(2026, 1, 15), date(2026, 3, 2), "month"
    ) == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert bucket_starts(
        date(9999, 11, 30), date(9999, 12, 31), "month"
    ) == [date(9999, 11, 1), date(9999, 12, 1)]


def test_report_computes_signed_flow_burn_and_runway_deterministically() -> None:
    report = build_cash_flow_report(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
        granularity="month",
        grouped_rows=[
            (date(2026, 1, 1), Decimal("1000.00"), Decimal("1500.00"), 2),
            (date(2026, 3, 1), Decimal("0.00"), Decimal("100.00"), 1),
        ],
        cash_balance=Decimal("2029.13"),
    )

    assert report["total_inflows"] == Decimal("1000.00")
    assert report["total_outflows"] == Decimal("1600.00")
    assert report["net_cash_flow"] == Decimal("-600.00")
    assert report["average_monthly_outflow"] == Decimal("541.10")
    assert report["average_monthly_net_burn"] == Decimal("202.91")
    assert report["runway_months"] == Decimal("10.00")
    assert report["runway_status"] == "estimated"
    assert report["buckets"][1]["inflows"] == Decimal("0.00")
    assert report["buckets"][1]["transaction_count"] == 0


def test_runway_is_explicitly_unavailable_without_balance_or_net_burn() -> None:
    no_balance = build_cash_flow_report(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 1),
        granularity="day",
        grouped_rows=[
            (date(2026, 1, 1), Decimal("0.00"), Decimal("12.00"), 1)
        ],
        cash_balance=None,
    )
    no_burn = build_cash_flow_report(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 1),
        granularity="day",
        grouped_rows=[
            (date(2026, 1, 1), Decimal("12.00"), Decimal("12.00"), 2)
        ],
        cash_balance=Decimal("500.00"),
    )

    assert no_balance["runway_months"] is None
    assert no_balance["runway_status"] == "cash_balance_required"
    assert no_burn["runway_months"] is None
    assert no_burn["runway_status"] == "no_net_burn"
    assert no_burn["average_monthly_net_burn"] == Decimal("0.00")
