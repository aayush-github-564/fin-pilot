import uuid
from decimal import Decimal
from alembic.environment import Optional
from pydantic import BaseModel, ConfigDict, Field


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    period: str
    limit_amount: Decimal = Field(max_digits=12, decimal_places=2)


class BudgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    category_id: uuid.UUID
    period: str
    limit_amount: Decimal = Field(max_digits=12, decimal_places=2)

class BudgetUpdate(BaseModel):
    category_id: Optional[uuid.UUID] = None
    period: Optional[str] = None
    limit_amount: Optional[Decimal] = Field(
        default=None, max_digits=12, decimal_places=2
    )
