from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

_STANDARD_RECORD_FIELDS = set(logging.makeLogRecord({}).__dict__)


class JsonLogFormatter(logging.Formatter):
    """Render a LogRecord and its extra fields as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_RECORD_FIELDS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging() -> None:
    """Install JSON formatting on application, worker, and server handlers."""
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    if not root_logger.handlers:
        root_logger.addHandler(logging.StreamHandler())

    loggers = (root_logger,) + tuple(
        logging.getLogger(name)
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "arq")
    )
    for logger in loggers:
        for handler in logger.handlers:
            handler.setFormatter(JsonLogFormatter())
