import uuid
from datetime import date, datetime
from decimal import Decimal
import enum

from sqlalchemy import (
    CheckConstraint,
    Date,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TransactionSource(str, enum.Enum):
    upload = "upload"
    manual = "manual"


class CategorizationStatus(str, enum.Enum):
    pending = "pending"
    done = "done"
    needs_review = "needs_review"
    failed = "failed"


class CategorizationSource(str, enum.Enum):
    rule = "rule"
    llm_auto = "llm_auto"
    llm_confirmed = "llm_confirmed"
    user = "user"


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint(
            "suggestion_confidence IS NULL OR "
            "(suggestion_confidence >= 0 AND suggestion_confidence <= 1)",
            name="ck_transactions_suggestion_confidence_range",
        ),
        Index(
            "ix_transactions_company_categorization_status",
            "company_id",
            "categorization_status",
        ),
        UniqueConstraint(
            "company_id",
            "import_fingerprint",
            name="uq_transactions_company_import_fingerprint",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True
    )
    source: Mapped[TransactionSource] = mapped_column(
        Enum(TransactionSource), nullable=False
    )
    categorization_status: Mapped[CategorizationStatus] = mapped_column(
        Enum(CategorizationStatus, name="categorization_status"),
        nullable=False,
        default=CategorizationStatus.done,
        server_default=CategorizationStatus.done.value,
    )
    categorization_source: Mapped[CategorizationSource | None] = mapped_column(
        Enum(CategorizationSource, name="categorization_source"), nullable=True
    )
    suggested_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "categories.id", name="fk_transactions_suggested_category_id_categories"
        ),
        nullable=True,
    )
    suggestion_confidence: Mapped[Decimal | None] = mapped_column(
        Numeric(3, 2), nullable=True
    )
    raw_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    import_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
