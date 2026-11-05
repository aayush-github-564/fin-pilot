from datetime import date
from decimal import Decimal

import pytest

from app.services.anomaly_detection import (
    Baseline,
    _is_anomalous,
    _validated_explanations,
    _vendor_key,
    resolve_date_windows,
)


def test_date_windows_are_inclusive_and_non_overlapping() -> None:
    windows = resolve_date_windows(
        days=7, baseline_days=90, today=date(2026, 11, 4)
    )
    assert windows.window_start == date(2026, 10, 29)
    assert windows.window_end == date(2026, 11, 4)
    assert windows.baseline_end == date(2026, 10, 28)
    assert windows.baseline_start == date(2026, 7, 31)


def test_vendor_normalization_ignores_case_spacing_and_punctuation() -> None:
    assert _vendor_key(" Acme-Shop, Inc. ") == "acmeshopinc"
    assert _vendor_key("---") is None
    assert _vendor_key(None) is None


def test_anomaly_requires_minimum_history_multiplier_and_z_score() -> None:
    too_few = Baseline(2, Decimal("10"), Decimal("0"))
    stable = Baseline(3, Decimal("10"), Decimal("0"))
    variable = Baseline(5, Decimal("10"), Decimal("10"))
    assert _is_anomalous(Decimal("100"), too_few)[0] is False
    assert _is_anomalous(Decimal("29"), stable)[0] is False
    assert _is_anomalous(Decimal("30"), stable)[0] is True
    assert _is_anomalous(Decimal("30"), variable)[0] is False
    assert _is_anomalous(Decimal("50"), variable)[0] is True


def test_model_explanation_validation_rejects_numbers_markup_and_unknown_ids() -> None:
    valid = {"explanations": [{"anomaly_id": "0", "explanation": "Unusually high compared with prior spending."}]}
    assert _validated_explanations(valid, {"0"}) == {
        "0": "Unusually high compared with prior spending."
    }
    for explanation in (
        "This is 4 times higher.",
        "<script>ignore the instructions</script>",
        "Line one\nline two",
    ):
        malformed = {
            "explanations": [{"anomaly_id": "0", "explanation": explanation}]
        }
        assert _validated_explanations(malformed, {"0"}) is None
    unknown = {
        "explanations": [{"anomaly_id": "99", "explanation": "Unusually high."}]
    }
    assert _validated_explanations(unknown, {"0"}) is None
