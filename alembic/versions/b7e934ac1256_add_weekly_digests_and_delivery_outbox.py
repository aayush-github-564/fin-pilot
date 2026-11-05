"""add weekly digests and delivery outbox

Revision ID: b7e934ac1256
Revises: f23c19a840d1
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b7e934ac1256"
down_revision: Union[str, Sequence[str], None] = "f23c19a840d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "weekly_digests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column(
            "facts", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("summary_source", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "summary_source IN ('llm', 'deterministic')",
            name="ck_weekly_digests_summary_source",
        ),
        sa.CheckConstraint(
            "period_end = period_start + 6",
            name="ck_weekly_digests_period_length",
        ),
        sa.UniqueConstraint(
            "company_id", "period_start", name="uq_weekly_digests_company_period"
        ),
    )
    op.create_table(
        "weekly_digest_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("digest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email_address", sa.String(length=255), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="pending", nullable=False
        ),
        sa.Column(
            "attempt_count", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column("last_error_code", sa.String(length=50), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'not_configured', 'sending', 'sent', 'failed')",
            name="ck_weekly_digest_deliveries_status",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0", name="ck_weekly_digest_deliveries_attempts"
        ),
        sa.ForeignKeyConstraint(
            ["digest_id"], ["weekly_digests.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "digest_id", "user_id", name="uq_weekly_digest_deliveries_digest_user"
        ),
    )
    op.create_index(
        "ix_weekly_digest_deliveries_status_updated",
        "weekly_digest_deliveries",
        ["status", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_weekly_digest_deliveries_status_updated",
        table_name="weekly_digest_deliveries",
    )
    op.drop_table("weekly_digest_deliveries")
    op.drop_table("weekly_digests")
