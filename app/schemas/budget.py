import uuid
from decimal import Decimal
from alembic.environment import Optional
from pydantic import BaseModel, ConfigDict


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    period: str
    limit_amount: Decimal


class BudgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    category_id: uuid.UUID
    period: str
    limit_amount: Decimal

class BudgetUpdate(BaseModel):
    category_id: Optional[uuid.UUID] = None
    period: Optional[str] = None
    limit_amount: Optional[Decimal] = None