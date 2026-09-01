import uuid
from pydantic import BaseModel, ConfigDict
from typing import Optional


class CategoryCreate(BaseModel):
    name: str
    parent_category_id: uuid.UUID | None = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    parent_category_id: uuid.UUID | None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_category_id: Optional[uuid.UUID] = None
