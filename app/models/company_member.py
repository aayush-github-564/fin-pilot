import uuid
from datetime import datetime
import enum

from sqlalchemy import ForeignKey, Enum, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CompanyRole(str, enum.Enum):
    owner = "owner"
    accountant = "accountant"
    viewer = "viewer"


class CompanyMember(Base):
    __tablename__ = "company_members"
    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_user_company"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    role: Mapped[CompanyRole] = mapped_column(Enum(CompanyRole), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
