import uuid
from datetime import datetime
import enum

from sqlalchemy import Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CategoryKind(str, enum.Enum):
    income = "income"
    expense = "expense"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[CategoryKind] = mapped_column(
        Enum(CategoryKind, name="category_kind"),
        nullable=False,
        default=CategoryKind.expense,
        server_default=CategoryKind.expense.value,
    )
    parent_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
