import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WeeklyDigest(Base):
    __tablename__ = "weekly_digests"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "period_start", name="uq_weekly_digests_company_period"
        ),
        CheckConstraint(
            "summary_source IN ('llm', 'deterministic')",
            name="ck_weekly_digests_summary_source",
        ),
        CheckConstraint(
            "period_end = period_start + 6", name="ck_weekly_digests_period_length"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    facts: Mapped[dict] = mapped_column(JSONB, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    summary_source: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WeeklyDigestDelivery(Base):
    __tablename__ = "weekly_digest_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "digest_id", "user_id", name="uq_weekly_digest_deliveries_digest_user"
        ),
        CheckConstraint(
            "status IN ('pending', 'not_configured', 'sending', 'sent', 'failed')",
            name="ck_weekly_digest_deliveries_status",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_weekly_digest_deliveries_attempts"),
        Index("ix_weekly_digest_deliveries_status_updated", "status", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    digest_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("weekly_digests.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    email_address: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    last_error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
