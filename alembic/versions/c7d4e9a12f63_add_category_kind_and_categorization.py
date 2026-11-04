"""add category kind and transaction categorization state

Revision ID: c7d4e9a12f63
Revises: 1a13e12b7aa6
Create Date: 2026-11-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c7d4e9a12f63"
down_revision: Union[str, Sequence[str], None] = "1a13e12b7aa6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    category_kind = postgresql.ENUM(
        "income", "expense", name="category_kind", create_type=False
    )
    categorization_status = postgresql.ENUM(
        "pending",
        "done",
        "needs_review",
        "failed",
        name="categorization_status",
        create_type=False,
    )
    categorization_source = postgresql.ENUM(
        "rule",
        "llm_auto",
        "llm_confirmed",
        "user",
        name="categorization_source",
        create_type=False,
    )

    category_kind.create(bind, checkfirst=True)
    categorization_status.create(bind, checkfirst=True)
    categorization_source.create(bind, checkfirst=True)

    op.add_column(
        "categories",
        sa.Column(
            "kind",
            category_kind,
            server_default=sa.text("'expense'"),
            nullable=False,
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "categorization_status",
            categorization_status,
            server_default=sa.text("'done'"),
            nullable=False,
        ),
    )
    op.add_column(
        "transactions",
        sa.Column("categorization_source", categorization_source, nullable=True),
    )
    op.add_column(
        "transactions",
        sa.Column("suggested_category_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "transactions",
        sa.Column("suggestion_confidence", sa.Numeric(3, 2), nullable=True),
    )
    op.create_foreign_key(
        "fk_transactions_suggested_category_id_categories",
        "transactions",
        "categories",
        ["suggested_category_id"],
        ["id"],
    )
    op.create_check_constraint(
        "ck_transactions_suggestion_confidence_range",
        "transactions",
        "suggestion_confidence IS NULL OR "
        "(suggestion_confidence >= 0 AND suggestion_confidence <= 1)",
    )
    op.create_index(
        "ix_transactions_company_categorization_status",
        "transactions",
        ["company_id", "categorization_status"],
        unique=False,
    )
    op.execute(
        "UPDATE transactions SET categorization_status = 'pending' "
        "WHERE category_id IS NULL"
    )
    op.execute(
        "UPDATE transactions AS transaction_row "
        "SET categorization_status = 'needs_review' "
        "FROM categories AS category_row "
        "WHERE transaction_row.category_id = category_row.id AND ("
        "(transaction_row.amount > 0 AND category_row.kind <> 'income') OR "
        "(transaction_row.amount < 0 AND category_row.kind <> 'expense'))"
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index(
        "ix_transactions_company_categorization_status", table_name="transactions"
    )
    op.drop_constraint(
        "ck_transactions_suggestion_confidence_range",
        "transactions",
        type_="check",
    )
    op.drop_constraint(
        "fk_transactions_suggested_category_id_categories",
        "transactions",
        type_="foreignkey",
    )
    op.drop_column("transactions", "suggestion_confidence")
    op.drop_column("transactions", "suggested_category_id")
    op.drop_column("transactions", "categorization_source")
    op.drop_column("transactions", "categorization_status")
    op.drop_column("categories", "kind")

    postgresql.ENUM(name="categorization_source").drop(bind, checkfirst=True)
    postgresql.ENUM(name="categorization_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="category_kind").drop(bind, checkfirst=True)
