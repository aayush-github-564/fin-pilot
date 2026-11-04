import io

import pytest

from app.scripts.evaluate_categorization import (
    EvaluationPrediction,
    _parse_labeled_rows,
    summarize_thresholds,
)


def test_threshold_summary_reports_precision_and_coverage() -> None:
    predictions = [
        EvaluationPrediction("Travel", "Travel", 0.96),
        EvaluationPrediction("Meals", "Travel", 0.92),
        EvaluationPrediction("Travel", "Travel", 0.80),
        EvaluationPrediction("Travel", None, None),
    ]

    report = summarize_thresholds(predictions, (0.80, 0.90, 0.95), 0.95)

    assert report == [
        {
            "threshold": 0.8,
            "auto_applied": 3,
            "correct": 2,
            "coverage": 0.75,
            "precision": 0.6667,
            "precision_target": 0.95,
            "target_met": False,
        },
        {
            "threshold": 0.9,
            "auto_applied": 2,
            "correct": 1,
            "coverage": 0.5,
            "precision": 0.5,
            "precision_target": 0.95,
            "target_met": False,
        },
        {
            "threshold": 0.95,
            "auto_applied": 1,
            "correct": 1,
            "coverage": 0.25,
            "precision": 1.0,
            "precision_target": 0.95,
            "target_met": True,
        },
    ]


def test_threshold_summary_handles_no_auto_applied_rows() -> None:
    result = summarize_thresholds(
        [EvaluationPrediction("Travel", None, None)], (0.85,)
    )[0]

    assert result["auto_applied"] == 0
    assert result["precision"] is None
    assert result["coverage"] == 0.0
    assert result["target_met"] is False


def test_evaluation_csv_parses_required_labels() -> None:
    rows = _parse_labeled_rows(
        io.StringIO("description,amount,expected_category\nHotel,-10.00,Travel\n")
    )

    assert rows == [
        {
            "description": "Hotel",
            "amount": "-10.00",
            "expected_category": "Travel",
        }
    ]


def test_evaluation_csv_requires_labels() -> None:
    with pytest.raises(ValueError, match="expected_category"):
        _parse_labeled_rows(io.StringIO("description,amount\nHotel,-10.00\n"))
