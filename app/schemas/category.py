import uuid
from pydantic import BaseModel, ConfigDict


class CategoryCreate(BaseModel):
    name: str
    parent_category_id: uuid.UUID | None = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    parent_category_id: uuid.UUID | None