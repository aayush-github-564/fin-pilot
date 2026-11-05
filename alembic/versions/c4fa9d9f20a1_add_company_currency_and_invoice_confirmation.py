"""add company currency and invoice confirmation metadata

Revision ID: c4fa9d9f20a1
Revises: b7e934ac1256
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4fa9d9f20a1"
down_revision: Union[str, Sequence[str], None] = "b7e934ac1256"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    invoice_direction = postgresql.ENUM(
        "purchase", "sale", name="invoice_direction", create_type=False
    )
    invoice_direction.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "companies",
        sa.Column("currency_code", sa.String(length=3), nullable=True),
    )
    op.create_check_constraint(
        "ck_companies_currency_code_format",
        "companies",
        "currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'",
    )

    op.add_column(
        "invoices",
        sa.Column("direction", invoice_direction, nullable=True),
    )
    op.add_column(
        "invoices",
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_invoices_confirmed_fields_present",
        "invoices",
        "confirmed_at IS NULL OR "
        "(direction IS NOT NULL AND vendor IS NOT NULL AND amount IS NOT NULL AND date IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_invoices_confirmed_fields_present", "invoices", type_="check"
    )
    op.drop_column("invoices", "confirmed_at")
    op.drop_column("invoices", "direction")
    op.drop_constraint(
        "ck_companies_currency_code_format", "companies", type_="check"
    )
    op.drop_column("companies", "currency_code")
    postgresql.ENUM(name="invoice_direction").drop(op.get_bind(), checkfirst=True)
