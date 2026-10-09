"""add processing_status to invoices

Revision ID: 128ff12ef5f1
Revises: 2e178eacaba2
Create Date: 2026-09-06 11:25:11.985525

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "128ff12ef5f1"
down_revision: Union[str, Sequence[str], None] = "2e178eacaba2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    processing_status_enum = sa.Enum(
        "pending", "processing", "complete", "failed", name="processingstatus"
    )
    processing_status_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "invoices",
        sa.Column(
            "processing_status",
            processing_status_enum,
            nullable=False,
            server_default="pending",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("invoices", "processing_status")
    sa.Enum(name="processingstatus").drop(op.get_bind(), checkfirst=True)
