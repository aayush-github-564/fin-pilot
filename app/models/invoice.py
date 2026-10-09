import enum
import uuid
from datetime import date as date_type, datetime

from sqlalchemy import Date, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class InvoiceStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"


class ProcessingStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus), nullable=False, default=InvoiceStatus.pending
    )
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus), nullable=False, default=ProcessingStatus.pending
    )
    extracted_raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    file_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
