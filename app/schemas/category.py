import uuid
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional

from app.models.category import CategoryKind


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: CategoryKind = CategoryKind.expense
    parent_category_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Category name cannot be blank")
        return value


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None
    name: str
    kind: CategoryKind
    parent_category_id: uuid.UUID | None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    kind: Optional[CategoryKind] = None
    parent_category_id: Optional[uuid.UUID] = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Category name cannot be blank")
        return value
