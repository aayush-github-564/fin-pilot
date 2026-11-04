"""add financial Q&A audit fields

Revision ID: f23c19a840d1
Revises: e4b713d62a90
Create Date: 2026-11-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f23c19a840d1"
down_revision: Union[str, Sequence[str], None] = "e4b713d62a90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_queries",
        sa.Column("query_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "chat_queries",
        sa.Column("result_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "chat_queries", sa.Column("error_code", sa.String(length=50), nullable=True)
    )
    op.create_index(
        "ix_chat_queries_company_created_at",
        "chat_queries",
        ["company_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_chat_queries_company_created_at", table_name="chat_queries")
    op.drop_column("chat_queries", "error_code")
    op.drop_column("chat_queries", "result_data")
    op.drop_column("chat_queries", "query_plan")
