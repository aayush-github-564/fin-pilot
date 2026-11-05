from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel


class WeeklyDigestRead(BaseModel):
    id: UUID
    company_id: UUID
    period_start: date
    period_end: date
    summary: str
    summary_source: Literal["llm", "deterministic"]
    facts: dict[str, Any]
    delivery_status: Literal[
        "pending", "not_configured", "sending", "sent", "failed"
    ] | None
    created_at: datetime
