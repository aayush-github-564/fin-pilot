"""add company-scoped transaction import idempotency

Revision ID: d58b2f6c91a4
Revises: c7d4e9a12f63
Create Date: 2026-11-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d58b2f6c91a4"
down_revision: Union[str, Sequence[str], None] = "c7d4e9a12f63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("import_fingerprint", sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_transactions_company_import_fingerprint",
        "transactions",
        ["company_id", "import_fingerprint"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_transactions_company_import_fingerprint",
        "transactions",
        type_="unique",
    )
    op.drop_column("transactions", "import_fingerprint")
