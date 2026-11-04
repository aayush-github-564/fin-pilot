import json
import logging

from app.core.logging import JsonLogFormatter


def test_json_formatter_includes_structured_extra_fields() -> None:
    record = logging.LogRecord(
        "finpilot.worker", logging.INFO, "worker.py", 10, "job finished", (), None
    )
    record.transaction_id = "tx-123"
    record.company_id = "company-123"
    record.outcome = "auto_applied"
    record.confidence = 0.95

    parsed = json.loads(JsonLogFormatter().format(record))

    assert parsed["message"] == "job finished"
    assert parsed["transaction_id"] == "tx-123"
    assert parsed["company_id"] == "company-123"
    assert parsed["outcome"] == "auto_applied"
    assert parsed["confidence"] == 0.95
