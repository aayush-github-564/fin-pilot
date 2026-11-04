from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.budget import BudgetCreate
from app.schemas.invoice import InvoiceCreate
from app.schemas.transaction import TransactionCreate


@pytest.mark.parametrize(
    "schema, payload",
    [
        (
            TransactionCreate,
            {"date": date(2026, 1, 1), "amount": Decimal("1.234"), "description": "x"},
        ),
        (
            InvoiceCreate,
            {"vendor": "x", "amount": Decimal("1.234"), "date": date(2026, 1, 1)},
        ),
        (
            BudgetCreate,
            {
                "category_id": "00000000-0000-0000-0000-000000000001",
                "period": "2026-01",
                "limit_amount": Decimal("1.234"),
            },
        ),
    ],
)
def test_financial_amounts_reject_fractional_cents(schema: type, payload: dict) -> None:
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


@pytest.mark.parametrize(
    "schema, payload",
    [
        (
            TransactionCreate,
            {"date": date(2026, 1, 1), "amount": Decimal("10000000000"), "description": "x"},
        ),
        (
            InvoiceCreate,
            {"vendor": "x", "amount": Decimal("10000000000"), "date": date(2026, 1, 1)},
        ),
    ],
)
def test_financial_amounts_reject_values_outside_database_precision(
    schema: type, payload: dict
) -> None:
    with pytest.raises(ValidationError):
        schema.model_validate(payload)
