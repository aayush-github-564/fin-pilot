from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class FinancialQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("question must not be blank")
        return normalized


class FinancialQueryRead(BaseModel):
    query_id: UUID
    supported: bool
    answer: str
    query_type: Literal[
        "cash_flow_summary",
        "expenses_by_category",
        "largest_expenses",
        "budget_vs_actual",
        "unsupported",
    ]
    period: str | None
    start_date: date | None
    end_date: date | None
    facts: dict[str, Any] = Field(default_factory=dict)
