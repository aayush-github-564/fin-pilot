"""Parse bounded bank-statement CSV uploads without performing database I/O."""

from __future__ import annotations

import csv
import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import StringIO

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CSV_ROWS = 1000
MAX_AMOUNT = Decimal("9999999999.99")

_HEADER_ALIASES: dict[str, set[str]] = {
    "date": {"date", "transaction date", "posted date", "posting date", "value date"},
    "description": {
        "description",
        "transaction description",
        "details",
        "narration",
        "memo",
        "payee",
        "particulars",
    },
    "amount": {"amount", "transaction amount"},
    "debit": {"debit", "debit amount", "withdrawal", "withdrawals"},
    "credit": {"credit", "credit amount", "deposit", "deposits"},
    "reference": {
        "transaction id",
        "transaction reference",
        "reference",
        "reference number",
        "ref no",
        "bank reference",
        "confirmation number",
    },
}
_ALIAS_TO_FIELD = {
    alias: field for field, aliases in _HEADER_ALIASES.items() for alias in aliases
}
_COMMA_GROUPED_NUMBER = re.compile(
    r"^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$"
)
_CURRENCY_PREFIX = re.compile(r"^(?:INR|USD|EUR|GBP|RS\.?)", re.IGNORECASE)
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y")


class CSVImportError(ValueError):
    """A file-level CSV error that prevents importing any rows."""


@dataclass(frozen=True)
class ParsedCSVRow:
    row_number: int
    transaction_date: date
    amount: Decimal
    description: str | None
    import_fingerprint: str


@dataclass(frozen=True)
class RejectedCSVRow:
    row_number: int
    error_code: str
    error_message: str


@dataclass(frozen=True)
class ParsedCSV:
    rows_seen: int
    accepted: list[ParsedCSVRow]
    rejected: list[RejectedCSVRow]


def _normalize_header(value: str) -> str:
    normalized = value.lstrip("\ufeff").strip().casefold()
    normalized = re.sub(r"[_-]+", " ", normalized)
    return " ".join(normalized.split())


def _parse_date(value: str) -> date:
    text = value.strip()
    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(text, date_format).date()
        except ValueError:
            continue
    raise ValueError("invalid_date")


def _parse_money(value: str, *, allow_blank: bool = False) -> Decimal:
    text = value.strip()
    if not text and allow_blank:
        return Decimal("0.00")
    if not text:
        raise ValueError("missing_amount")

    negative_by_parentheses = text.startswith("(") and text.endswith(")")
    if text.startswith("(") != text.endswith(")"):
        raise ValueError("invalid_amount")
    if negative_by_parentheses:
        text = text[1:-1].strip()

    text = _CURRENCY_PREFIX.sub("", text, count=1).strip()
    for symbol in ("₹", "$", "€", "£"):
        text = text.replace(symbol, "")
    text = "".join(text.split())

    signless = text.lstrip("+-")
    if text[:1] in {"+", "-"} and signless[:1] in {"+", "-"}:
        raise ValueError("invalid_amount")
    if "," in signless:
        integer_part = signless.split(".", 1)[0]
        if not _COMMA_GROUPED_NUMBER.fullmatch(integer_part):
            raise ValueError("invalid_amount")
        text = text.replace(",", "")

    if negative_by_parentheses and text.startswith(("+", "-")):
        raise ValueError("invalid_amount")
    try:
        amount = Decimal(text)
    except InvalidOperation as error:
        raise ValueError("invalid_amount") from error
    if not amount.is_finite():
        raise ValueError("invalid_amount")
    if amount.as_tuple().exponent < -2 or abs(amount) > MAX_AMOUNT:
        raise ValueError("amount_out_of_range")
    if negative_by_parentheses:
        amount = -amount
    return amount.quantize(Decimal("0.01"))


def _header_positions(header: list[str]) -> dict[str, int]:
    positions: dict[str, int] = {}
    for index, heading in enumerate(header):
        canonical = _ALIAS_TO_FIELD.get(_normalize_header(heading))
        if canonical is None:
            continue
        if canonical in positions:
            raise CSVImportError(f"CSV has more than one {canonical} column")
        positions[canonical] = index

    missing = {"date", "description"} - positions.keys()
    has_amount = "amount" in positions
    has_debit_credit = "debit" in positions and "credit" in positions
    if missing or (not has_amount and not has_debit_credit):
        raise CSVImportError(
            "CSV must include date and description, plus amount or both debit and credit columns"
        )
    if has_amount and ("debit" in positions or "credit" in positions):
        raise CSVImportError("CSV cannot combine amount with debit or credit columns")
    if ("debit" in positions) != ("credit" in positions):
        raise CSVImportError("CSV must include both debit and credit columns")
    return positions


def _fingerprint(reference: str | None, file_hash: str, row_number: int) -> str:
    if reference and reference.strip():
        identity = "bank-reference:" + " ".join(reference.split()).casefold()
    else:
        identity = f"file-row:{file_hash}:{row_number}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def parse_bank_statement_csv(content: bytes) -> ParsedCSV:
    """Parse supported bank CSV formats and return valid and rejected rows.

    Dates use ISO format, day-first slash/dash formats, or US month-first slash
    format when the first component cannot be a day. Ambiguous slash dates are
    interpreted day-first, matching the project's locale.
    """
    if len(content) > MAX_CSV_BYTES:
        raise CSVImportError("CSV file exceeds the 5 MiB upload limit")
    if not content:
        raise CSVImportError("CSV file is empty")
    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise CSVImportError("CSV must use UTF-8 encoding") from error
    if "\x00" in decoded:
        raise CSVImportError("CSV contains a null byte")

    reader = csv.reader(StringIO(decoded, newline=""), strict=True)
    try:
        header = next(reader, None)
        if not header or not any(cell.strip() for cell in header):
            raise CSVImportError("CSV header row is missing")
        positions = _header_positions(header)
        file_hash = hashlib.sha256(content).hexdigest()
        accepted: list[ParsedCSVRow] = []
        rejected: list[RejectedCSVRow] = []
        rows_seen = 0

        for row_number, cells in enumerate(reader, start=2):
            if not cells or not any(cell.strip() for cell in cells):
                continue
            rows_seen += 1
            if rows_seen > MAX_CSV_ROWS:
                raise CSVImportError("CSV exceeds the 1,000 transaction row limit")
            if len(cells) > len(header):
                rejected.append(
                    RejectedCSVRow(
                        row_number,
                        "too_many_columns",
                        "Row has more fields than the CSV header",
                    )
                )
                continue
            cells.extend([""] * (len(header) - len(cells)))

            try:
                transaction_date = _parse_date(cells[positions["date"]])
                description = cells[positions["description"]].strip() or None
                if "amount" in positions:
                    amount = _parse_money(cells[positions["amount"]])
                else:
                    debit = _parse_money(cells[positions["debit"]], allow_blank=True)
                    credit = _parse_money(cells[positions["credit"]], allow_blank=True)
                    if debit < 0 or credit < 0:
                        raise ValueError("negative_debit_or_credit")
                    if debit > 0 and credit > 0:
                        raise ValueError("debit_and_credit_both_set")
                    if not cells[positions["debit"]].strip() and not cells[
                        positions["credit"]
                    ].strip():
                        raise ValueError("missing_amount")
                    amount = credit - debit
                reference = (
                    cells[positions["reference"]]
                    if "reference" in positions
                    else None
                )
                import_fingerprint = _fingerprint(reference, file_hash, row_number)
                accepted.append(
                    ParsedCSVRow(
                        row_number=row_number,
                        transaction_date=transaction_date,
                        amount=amount,
                        description=description,
                        import_fingerprint=import_fingerprint,
                    )
                )
            except ValueError as error:
                code = str(error)
                messages = {
                    "invalid_date": "Date must use a supported date format",
                    "missing_amount": "Amount is required",
                    "invalid_amount": "Amount is not a valid decimal currency value",
                    "amount_out_of_range": "Amount exceeds supported currency precision",
                    "negative_debit_or_credit": "Debit and credit values must be non-negative",
                    "debit_and_credit_both_set": "A row cannot contain both a debit and a credit",
                }
                rejected.append(
                    RejectedCSVRow(
                        row_number,
                        code,
                        messages.get(code, "Row contains an invalid value"),
                    )
                )
    except csv.Error as error:
        raise CSVImportError("CSV is malformed") from error

    if rows_seen == 0:
        raise CSVImportError("CSV contains no transaction rows")
    return ParsedCSV(rows_seen=rows_seen, accepted=accepted, rejected=rejected)
