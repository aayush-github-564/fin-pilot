import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

BudgetPeriod = Annotated[
    str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
]


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    period: BudgetPeriod
    limit_amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)

    @field_validator("period")
    @classmethod
    def period_must_be_a_real_month(cls, value: str) -> str:
        try:
            date.fromisoformat(f"{value}-01")
        except ValueError as error:
            raise ValueError("period must be a valid YYYY-MM month") from error
        return value


class BudgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    category_id: uuid.UUID
    period: str
    limit_amount: Decimal = Field(max_digits=12, decimal_places=2)

class BudgetUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    period: BudgetPeriod | None = None
    limit_amount: Decimal | None = Field(
        default=None, gt=0, max_digits=12, decimal_places=2
    )

    @field_validator("period")
    @classmethod
    def period_must_be_a_real_month(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            date.fromisoformat(f"{value}-01")
        except ValueError as error:
            raise ValueError("period must be a valid YYYY-MM month") from error
        return value
