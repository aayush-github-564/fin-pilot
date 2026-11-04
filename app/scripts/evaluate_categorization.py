"""Manual, metered evaluation for LLM transaction categorization.

This script is intentionally not called by the automated test suite. It makes one
real Anthropic request per eligible row in a labeled CSV file.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from io import TextIOBase
from pathlib import Path
from uuid import UUID

import anthropic
from sqlalchemy import or_, select

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.category import Category, CategoryKind
from app.services.categorization import category_kind_for_amount
from app.services.llm_categorization import suggest_category

DEFAULT_THRESHOLDS = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95)
DEFAULT_PRECISION_TARGET = 0.95
REQUIRED_COLUMNS = {"description", "amount", "expected_category"}


@dataclass(frozen=True)
class EvaluationPrediction:
    expected_category: str
    predicted_category: str | None
    confidence: float | None


def summarize_thresholds(
    predictions: list[EvaluationPrediction],
    thresholds: tuple[float, ...] = DEFAULT_THRESHOLDS,
    precision_target: float = DEFAULT_PRECISION_TARGET,
) -> list[dict[str, float | int | bool | None]]:
    total = len(predictions)
    summary: list[dict[str, float | int | bool | None]] = []
    for threshold in thresholds:
        applied = [
            row
            for row in predictions
            if row.predicted_category is not None
            and row.confidence is not None
            and row.confidence >= threshold
        ]
        correct = sum(
            row.predicted_category == row.expected_category for row in applied
        )
        precision = correct / len(applied) if applied else None
        coverage = len(applied) / total if total else 0.0
        summary.append(
            {
                "threshold": threshold,
                "auto_applied": len(applied),
                "correct": correct,
                "coverage": round(coverage, 4),
                "precision": round(precision, 4) if precision is not None else None,
                "precision_target": precision_target,
                "target_met": precision is not None and precision >= precision_target,
            }
        )
    return summary


async def _load_company_categories(company_id: UUID) -> list[Category]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Category).where(
                or_(
                    Category.company_id == company_id,
                    Category.company_id.is_(None),
                )
            )
        )
        return result.scalars().all()


def _parse_labeled_rows(source: TextIOBase) -> list[dict[str, str]]:
    reader = csv.DictReader(source)
    if reader.fieldnames is None or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
        missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames or []))
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")
    rows = list(reader)
    if not rows:
        raise ValueError("CSV has no labeled transaction rows")
    return rows


def _read_labeled_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as source:
        return _parse_labeled_rows(source)


async def evaluate(csv_path: Path, company_id: UUID) -> dict[str, object]:
    rows = _read_labeled_rows(csv_path)
    categories = await _load_company_categories(company_id)
    categories_by_kind: dict[CategoryKind, dict[str, UUID]] = {
        CategoryKind.income: {},
        CategoryKind.expense: {},
    }
    categories = sorted(
        categories,
        key=lambda category: (
            category.name.casefold(),
            category.company_id != company_id,
            str(category.id),
        ),
    )
    for category in categories:
        categories_by_kind[category.kind].setdefault(category.name, category.id)

    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        max_retries=0,
        timeout=60.0,
    )
    predictions: list[EvaluationPrediction] = []
    request_count = 0
    try:
        for row_number, row in enumerate(rows, start=2):
            try:
                amount = Decimal(row.get("amount") or "")
            except (InvalidOperation, TypeError) as error:
                raise ValueError(f"CSV row {row_number} has an invalid amount") from error
            if not amount.is_finite():
                raise ValueError(f"CSV row {row_number} has a non-finite amount")
            if amount.as_tuple().exponent < -2 or abs(amount) > Decimal("9999999999.99"):
                raise ValueError(
                    f"CSV row {row_number} exceeds the supported currency precision"
                )

            expected = (row.get("expected_category") or "").strip()
            if not expected:
                raise ValueError(f"CSV row {row_number} has no expected category")

            category_kind = category_kind_for_amount(amount)
            if category_kind is None:
                predictions.append(EvaluationPrediction(expected, None, None))
                continue

            allowed_names = list(categories_by_kind[category_kind])
            if expected not in allowed_names:
                raise ValueError(
                    f"CSV row {row_number} expected category is not available "
                    "for the transaction direction"
                )

            suggestion = await suggest_category(
                client,
                model=settings.categorization_model,
                description=row.get("description") or "",
                direction="inflow" if category_kind == CategoryKind.income else "outflow",
                absolute_amount=abs(amount),
                allowed_category_names=allowed_names,
            )
            request_count += 1
            predictions.append(
                EvaluationPrediction(
                    expected_category=expected,
                    predicted_category=suggestion.category if suggestion.valid else None,
                    confidence=suggestion.confidence if suggestion.valid else None,
                )
            )
    finally:
        await client.close()

    return {
        "model": settings.categorization_model,
        "labeled_rows": len(predictions),
        "api_requests": request_count,
        "fixed_precision_target": DEFAULT_PRECISION_TARGET,
        "threshold_metrics": summarize_thresholds(predictions),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--company-id", required=True, type=UUID)
    arguments = parser.parse_args()
    report = asyncio.run(evaluate(arguments.csv_path, arguments.company_id))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
