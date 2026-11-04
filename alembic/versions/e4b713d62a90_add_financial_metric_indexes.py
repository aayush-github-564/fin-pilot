"""add indexes for cash-flow and budget metric queries

Revision ID: e4b713d62a90
Revises: d58b2f6c91a4
Create Date: 2026-11-04

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e4b713d62a90"
down_revision: Union[str, Sequence[str], None] = "d58b2f6c91a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_transactions_company_date",
        "transactions",
        ["company_id", "date"],
        unique=False,
    )
    op.create_index(
        "ix_budgets_company_period",
        "budgets",
        ["company_id", "period"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_budgets_company_period", table_name="budgets")
    op.drop_index("ix_transactions_company_date", table_name="transactions")
