"""supabase auth and company membership

Revision ID: 9b1e831e2522
Revises: c4fa9d9f20a1
Create Date: 2026-11-12 09:39:37.784242

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9b1e831e2522'
down_revision: Union[str, Sequence[str], None] = 'c4fa9d9f20a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing memberships keep their current values. PostgreSQL cannot remove
    # an enum value safely during downgrade, so downgrade leaves `member` present.
    op.execute("ALTER TYPE companyrole ADD VALUE IF NOT EXISTS 'member'")

    op.add_column(
        "users", sa.Column("auth_user_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column("users", sa.Column("full_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.String(length=2048), nullable=True))
    op.alter_column("users", "hashed_password", existing_type=sa.String(length=255), nullable=True)
    op.create_unique_constraint("uq_users_auth_user_id", "users", ["auth_user_id"])

    company_role = postgresql.ENUM(
        "owner", "accountant", "member", "viewer", name="companyrole", create_type=False
    )
    op.create_table(
        "company_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", company_role, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "uq_company_pending_invitation_email",
        "company_invitations",
        ["company_id", "email"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "membership_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_email", sa.String(length=255), nullable=True),
        sa.Column("before_role", company_role, nullable=True),
        sa.Column("after_role", company_role, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_membership_events_company_created_at",
        "membership_events",
        ["company_id", "created_at"],
    )


def downgrade() -> None:
    has_supabase_users = op.get_bind().execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM users "
            "WHERE auth_user_id IS NOT NULL OR hashed_password IS NULL)"
        )
    ).scalar_one()
    if has_supabase_users:
        raise RuntimeError(
            "Cannot downgrade while Supabase-authenticated users exist; "
            "that would remove their identity mapping."
        )
    op.drop_index("ix_membership_events_company_created_at", table_name="membership_events")
    op.drop_table("membership_events")
    op.drop_index("uq_company_pending_invitation_email", table_name="company_invitations")
    op.drop_table("company_invitations")
    op.drop_constraint("uq_users_auth_user_id", "users", type_="unique")
    op.alter_column("users", "hashed_password", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "full_name")
    op.drop_column("users", "auth_user_id")
    # PostgreSQL does not support removing an enum label without recreating the type.
