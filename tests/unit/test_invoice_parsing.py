import datetime
from decimal import Decimal

import pytest

from app.worker import _clean_json_response, _parse_invoice_fields


def test_clean_json_response_accepts_raw_object() -> None:
    assert _clean_json_response('{"vendor":"Acme"}') == {"vendor": "Acme"}


def test_clean_json_response_accepts_json_code_fence() -> None:
    assert _clean_json_response('```json\n{"vendor":"Acme"}\n```') == {
        "vendor": "Acme"
    }


@pytest.mark.parametrize("value", ["[]", "null", "```text\n{}\n```", "```json\n{}"])
def test_clean_json_response_rejects_invalid_shapes(value: str) -> None:
    with pytest.raises((ValueError, TypeError)):
        _clean_json_response(value)


def test_parse_invoice_fields_validates_without_partial_conversion() -> None:
    parsed = _parse_invoice_fields(
        {"vendor": "  Acme  ", "amount": 12.5, "date": "2026-01-31"}
    )

    assert parsed == ("Acme", Decimal("12.5"), datetime.date(2026, 1, 31))


@pytest.mark.parametrize(
    "value",
    [
        {"vendor": 5},
        {"amount": True},
        {"amount": "12.50"},
        {"amount": 12.345},
        {"amount": 10000000000},
        {"date": "31-01-2026"},
    ],
)
def test_parse_invoice_fields_rejects_wrong_types_and_precision(value: dict) -> None:
    with pytest.raises((ValueError, TypeError)):
        _parse_invoice_fields(value)


def test_parse_invoice_fields_allows_missing_values_for_manual_review() -> None:
    assert _parse_invoice_fields({"vendor": None, "amount": None, "date": None}) == (
        None,
        None,
        None,
    )
