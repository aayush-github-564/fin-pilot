from datetime import date
from decimal import Decimal

import pytest

from app.services.csv_import import (
    CSVImportError,
    MAX_CSV_BYTES,
    MAX_CSV_ROWS,
    parse_bank_statement_csv,
)


def test_parser_supports_aliases_signed_amounts_and_row_level_rejections() -> None:
    content = (
        "Transaction Date,Details,Transaction Amount,Reference\n"
        '05/01/2026,Card purchase,"-₹ 1,234.50",REF-1\n'
        "2026-01-06,Customer deposit,(25.00),REF-2\n"
        "not-a-date,Invalid row,12.00,REF-3\n"
        "2026-01-07,Invalid precision,12.345,REF-4\n"
    ).encode()

    parsed = parse_bank_statement_csv(content)

    assert parsed.rows_seen == 4
    assert [(row.transaction_date, row.amount) for row in parsed.accepted] == [
        (date(2026, 1, 5), Decimal("-1234.50")),
        (date(2026, 1, 6), Decimal("-25.00")),
    ]
    assert [row.error_code for row in parsed.rejected] == [
        "invalid_date",
        "amount_out_of_range",
    ]


def test_parser_supports_debit_credit_and_preserves_identical_transactions() -> None:
    content = (
        "Date,Description,Debit,Credit\n"
        "2026-01-01,Coffee,5.00,\n"
        "2026-01-01,Coffee,5.00,\n"
        "2026-01-02,Refund,,7.50\n"
    ).encode()

    parsed = parse_bank_statement_csv(content)

    assert [row.amount for row in parsed.accepted] == [
        Decimal("-5.00"),
        Decimal("-5.00"),
        Decimal("7.50"),
    ]
    assert parsed.accepted[0].import_fingerprint != parsed.accepted[1].import_fingerprint


def test_bank_reference_is_normalized_as_a_stable_deduplication_key() -> None:
    content = (
        "Date,Description,Amount,Transaction ID\n"
        "2026-01-01,Purchase,-10.00,  AbC  123 \n"
        "2026-01-02,Refund,10.00,abc 123\n"
    ).encode()

    parsed = parse_bank_statement_csv(content)

    assert parsed.accepted[0].import_fingerprint == parsed.accepted[1].import_fingerprint


@pytest.mark.parametrize(
    "content",
    [
        b"Date,Description\n2026-01-01,Missing amount\n",
        b"Date,Description,Amount,Debit,Credit\n2026-01-01,x,1,,\n",
        b"Date,Description,Debit\n2026-01-01,x,1\n",
        b"Date,Date,Description,Amount\n2026-01-01,2026-01-01,x,1\n",
        b"not,csv\xff",
    ],
)
def test_file_level_contract_errors(content: bytes) -> None:
    with pytest.raises(CSVImportError):
        parse_bank_statement_csv(content)


def test_file_size_and_row_limits_are_enforced_before_import() -> None:
    with pytest.raises(CSVImportError, match="5 MiB"):
        parse_bank_statement_csv(b"x" * (MAX_CSV_BYTES + 1))

    content = "Date,Description,Amount\n" + "2026-01-01,x,1\n" * (MAX_CSV_ROWS + 1)
    with pytest.raises(CSVImportError, match="1,000"):
        parse_bank_statement_csv(content.encode())
