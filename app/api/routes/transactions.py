import asyncio
import logging
import uuid
from datetime import date as date_type
from typing import Literal
from uuid import UUID

from arq import ArqRedis
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy import case, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_arq_redis,
    get_current_company_member,
    get_db,
    require_any_permission,
    require_permission,
)
from app.core.permissions import Permission, ROLE_PERMISSIONS
from app.models.category import Category, CategoryKind
from app.models.company_member import CompanyMember
from app.models.transaction import (
    CategorizationSource,
    CategorizationStatus,
    Transaction,
    TransactionSource,
)
from app.schemas.transaction import (
    CSVImportRead,
    CSVImportRowRead,
    TransactionCreate,
    TransactionPageRead,
    TransactionRead,
    TransactionUpdate,
)
from app.services.categorization import (
    category_kind_for_amount,
    match_category,
    resolve_category_id,
)
from app.services.category_scope import validate_category_scope
from app.services.csv_import import (
    MAX_CSV_BYTES,
    CSVImportError,
    ParsedCSVRow,
    parse_bank_statement_csv,
)
from app.services.storage import save_file

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/companies/{company_id}/transactions", tags=["transactions"])


async def _enqueue_categorization(
    redis: ArqRedis, transaction_id: UUID, request_id: str
) -> None:
    try:
        await redis.enqueue_job(
            "categorize_transaction",
            str(transaction_id),
            request_id,
            _job_id=f"categorize:{transaction_id}",
        )
    except Exception:
        # The committed row remains pending; the scheduled sweeper can recover it.
        logger.exception(
            "Could not enqueue transaction categorization",
            extra={"transaction_id": str(transaction_id), "request_id": request_id},
        )


@router.post("", response_model=TransactionRead, status_code=201)
async def create_transaction(
    company_id: uuid.UUID,
    payload: TransactionCreate,
    request: Request,
    membership: CompanyMember = Depends(require_permission(Permission.transaction_manage)),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
):
    data = payload.model_dump(exclude={"category_id"})
    category_kind = category_kind_for_amount(payload.amount)
    category_id = payload.category_id
    categorization_source = None

    if category_id is not None:
        await validate_category_scope(
            db, company_id, category_id, expected_kind=category_kind
        )
        categorization_source = CategorizationSource.user
    elif category_kind is not None:
        category_id = await resolve_category_id(
            payload.description, db, category_kind
        )
        if category_id is not None:
            categorization_source = CategorizationSource.rule

    if category_id is not None:
        categorization_status = CategorizationStatus.done
    elif category_kind is None:
        # A zero amount has no direction, so it cannot be safely auto-categorized.
        categorization_status = CategorizationStatus.needs_review
    else:
        categorization_status = CategorizationStatus.pending

    transaction = Transaction(
        company_id=company_id,
        category_id=category_id,
        categorization_status=categorization_status,
        categorization_source=categorization_source,
        **data,
    )
    db.add(transaction)
    await db.commit()
    await db.refresh(transaction)

    if categorization_status == CategorizationStatus.pending:
        await _enqueue_categorization(
            redis, transaction.id, request.state.request_id
        )
    return transaction


@router.get("", response_model=TransactionPageRead)
async def list_transactions(
    company_id: uuid.UUID,
    offset: int = Query(default=0, ge=0, le=100_000),
    limit: int = Query(default=50, ge=1, le=200),
    start_date: date_type | None = Query(default=None),
    end_date: date_type | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    categorization_status: CategorizationStatus | None = Query(default=None),
    source: TransactionSource | None = Query(default=None),
    direction: Literal["inflow", "outflow"] | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must be on or before end_date"
        )
    filters = [Transaction.company_id == company_id]
    if start_date is not None:
        filters.append(Transaction.date >= start_date)
    if end_date is not None:
        filters.append(Transaction.date <= end_date)
    if category_id is not None:
        filters.append(Transaction.category_id == category_id)
    if categorization_status is not None:
        filters.append(Transaction.categorization_status == categorization_status)
    if source is not None:
        filters.append(Transaction.source == source)
    if direction == "inflow":
        filters.append(Transaction.amount > 0)
    elif direction == "outflow":
        filters.append(Transaction.amount < 0)
    if search and search.strip():
        escaped_search = (
            search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        filters.append(
            Transaction.description.ilike(f"%{escaped_search}%", escape="\\")
        )

    await db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    total = await db.scalar(
        select(func.count(Transaction.id)).where(*filters)
    )
    result = await db.execute(
        select(Transaction)
        .where(*filters)
        .order_by(
            Transaction.date.desc(),
            Transaction.created_at.desc(),
            Transaction.id,
        )
        .offset(offset)
        .limit(limit)
    )
    items = result.scalars().all()
    total_count = int(total or 0)
    return TransactionPageRead(
        items=items,
        total=total_count,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total_count,
    )


@router.get("/review", response_model=list[TransactionRead])
async def list_transactions_for_review(
    company_id: uuid.UUID,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.company_id == company_id,
            Transaction.categorization_status == CategorizationStatus.needs_review,
        )
        .order_by(
            Transaction.date.desc(),
            Transaction.created_at.desc(),
            Transaction.id,
        )
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/import-csv", response_model=CSVImportRead, status_code=200)
async def import_transactions_csv(
    company_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    membership: CompanyMember = Depends(require_permission(Permission.transaction_manage)),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
) -> CSVImportRead:
    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV file exceeds the 5 MiB upload limit")
    try:
        parsed = parse_bank_statement_csv(content)
    except CSVImportError as error:
        logger.warning(
            "Bank statement CSV rejected",
            extra={
                "request_id": request.state.request_id,
                "company_id": str(company_id),
                "error_type": type(error).__name__,
            },
        )
        raise HTTPException(status_code=422, detail=str(error)) from error

    first_by_fingerprint: dict[str, ParsedCSVRow] = {}
    duplicate_row_numbers: set[int] = set()
    for row in parsed.accepted:
        if row.import_fingerprint in first_by_fingerprint:
            duplicate_row_numbers.add(row.row_number)
        else:
            first_by_fingerprint[row.import_fingerprint] = row

    candidate_rows = list(first_by_fingerprint.values())
    matched_names = {
        matched_name
        for row in candidate_rows
        if (
            matched_name := match_category(
                row.description, category_kind_for_amount(row.amount)
            )
        )
    }
    category_ids_by_name: dict[str, UUID] = {}
    if matched_names:
        category_result = await db.execute(
            select(Category.name, Category.id).where(
                Category.company_id.is_(None),
                Category.kind == CategoryKind.expense,
                Category.name.in_(matched_names),
            )
        )
        category_ids_by_name = {
            name: category_id for name, category_id in category_result.all()
        }

    values_by_fingerprint: dict[str, dict[str, object]] = {}
    pending_transaction_ids: dict[UUID, str] = {}
    for row in candidate_rows:
        kind = category_kind_for_amount(row.amount)
        rule_name = match_category(row.description, kind)
        category_id = category_ids_by_name.get(rule_name) if rule_name else None
        if category_id is not None:
            categorization_status = CategorizationStatus.done
            categorization_source = CategorizationSource.rule
        elif kind is None:
            categorization_status = CategorizationStatus.needs_review
            categorization_source = None
        else:
            categorization_status = CategorizationStatus.pending
            categorization_source = None

        transaction_id = uuid.uuid4()
        values_by_fingerprint[row.import_fingerprint] = {
            "id": transaction_id,
            "company_id": company_id,
            "date": row.transaction_date,
            "amount": row.amount,
            "description": row.description,
            "category_id": category_id,
            "source": TransactionSource.upload,
            "categorization_status": categorization_status,
            "categorization_source": categorization_source,
            "raw_reference": None,
            "import_fingerprint": row.import_fingerprint,
        }
        if categorization_status == CategorizationStatus.pending:
            pending_transaction_ids[transaction_id] = request.state.request_id

    inserted_by_fingerprint: dict[str, UUID] = {}
    newly_inserted_fingerprints: set[str] = set()
    if values_by_fingerprint:
        statement = (
            pg_insert(Transaction)
            .values(list(values_by_fingerprint.values()))
            .on_conflict_do_nothing(
                constraint="uq_transactions_company_import_fingerprint"
            )
            .returning(Transaction.id, Transaction.import_fingerprint)
        )
        insert_result = await db.execute(statement)
        inserted_by_fingerprint = {
            fingerprint: transaction_id
            for transaction_id, fingerprint in insert_result.all()
        }
        newly_inserted_fingerprints = set(inserted_by_fingerprint)

        if newly_inserted_fingerprints:
            await file.seek(0)
            file_reference = await save_file(file, company_id, extension=".csv")
            row_numbers_by_fingerprint = {
                row.import_fingerprint: row.row_number for row in candidate_rows
            }
            raw_references_by_id = {
                inserted_by_fingerprint[fingerprint]: (
                    f"csv:{file_reference}#record="
                    f"{row_numbers_by_fingerprint[fingerprint]}"
                )
                for fingerprint in newly_inserted_fingerprints
            }
            await db.execute(
                update(Transaction)
                .where(Transaction.id.in_(raw_references_by_id))
                .values(
                    raw_reference=case(
                        raw_references_by_id,
                        value=Transaction.id,
                        else_=None,
                    )
                )
            )

        duplicate_fingerprints = set(values_by_fingerprint) - set(
            inserted_by_fingerprint
        )
        existing_by_fingerprint: dict[str, UUID] = {}
        if duplicate_fingerprints:
            existing_result = await db.execute(
                select(Transaction.import_fingerprint, Transaction.id).where(
                    Transaction.company_id == company_id,
                    Transaction.import_fingerprint.in_(duplicate_fingerprints),
                )
            )
            existing_by_fingerprint = {
                fingerprint: transaction_id
                for fingerprint, transaction_id in existing_result.all()
            }
        await db.commit()
        inserted_by_fingerprint.update(existing_by_fingerprint)
    else:
        await db.rollback()

    # Only newly returned rows are eligible for categorization; conflict winners
    # belong to an earlier request and must never be re-enqueued here.
    committed_insert_ids = {
        inserted_by_fingerprint[fingerprint]
        for fingerprint in newly_inserted_fingerprints
        if inserted_by_fingerprint[fingerprint] in pending_transaction_ids
    }
    semaphore = asyncio.Semaphore(20)

    async def enqueue_pending(transaction_id: UUID, request_id: str) -> None:
        async with semaphore:
            await _enqueue_categorization(redis, transaction_id, request_id)

    await asyncio.gather(
        *(
            enqueue_pending(transaction_id, request_id)
            for transaction_id, request_id in pending_transaction_ids.items()
            if transaction_id in committed_insert_ids
        )
    )

    outcomes_by_row: dict[int, CSVImportRowRead] = {
        row.row_number: CSVImportRowRead(
            row_number=row.row_number,
            status="rejected",
            error_code=row.error_code,
            error_message=row.error_message,
        )
        for row in parsed.rejected
    }
    seen_fingerprints: set[str] = set()
    for row in parsed.accepted:
        transaction_id = inserted_by_fingerprint.get(row.import_fingerprint)
        is_duplicate = (
            row.row_number in duplicate_row_numbers
            or row.import_fingerprint not in newly_inserted_fingerprints
            or row.import_fingerprint in seen_fingerprints
        )
        seen_fingerprints.add(row.import_fingerprint)
        if is_duplicate:
            outcomes_by_row[row.row_number] = CSVImportRowRead(
                row_number=row.row_number,
                status="duplicate",
                transaction_id=transaction_id,
            )
            continue

        values = values_by_fingerprint[row.import_fingerprint]
        outcomes_by_row[row.row_number] = CSVImportRowRead(
            row_number=row.row_number,
            status="imported",
            transaction_id=transaction_id,
            categorization_status=values["categorization_status"],
        )

    for rejected in parsed.rejected:
        logger.warning(
            "Bank statement row rejected",
            extra={
                "request_id": request.state.request_id,
                "company_id": str(company_id),
                "row_number": rejected.row_number,
                "error_code": rejected.error_code,
            },
        )

    rows = [outcomes_by_row[index] for index in sorted(outcomes_by_row)]
    imported_count = sum(row.status == "imported" for row in rows)
    duplicate_count = sum(row.status == "duplicate" for row in rows)
    rejected_count = sum(row.status == "rejected" for row in rows)
    logger.info(
        "Bank statement CSV import completed",
        extra={
            "request_id": request.state.request_id,
            "company_id": str(company_id),
            "rows_seen": parsed.rows_seen,
            "imported_count": imported_count,
            "duplicate_count": duplicate_count,
            "rejected_count": rejected_count,
        },
    )
    return CSVImportRead(
        rows_seen=parsed.rows_seen,
        imported_count=imported_count,
        duplicate_count=duplicate_count,
        rejected_count=rejected_count,
        rows=rows,
    )


@router.post(
    "/{transaction_id}/accept-suggestion", response_model=TransactionRead
)
async def accept_transaction_suggestion(
    transaction_id: UUID,
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.transaction_categorize)),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.company_id == company_id,
            Transaction.categorization_status == CategorizationStatus.needs_review,
            Transaction.category_id.is_(None),
            Transaction.suggested_category_id.is_not(None),
        )
    )
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise HTTPException(
            status_code=409, detail="No pending category suggestion is available"
        )

    category_kind = category_kind_for_amount(transaction.amount)
    await validate_category_scope(
        db,
        company_id,
        transaction.suggested_category_id,
        expected_kind=category_kind,
    )
    suggested_category_id = transaction.suggested_category_id
    statement = (
        update(Transaction)
        .where(
            Transaction.id == transaction_id,
            Transaction.company_id == company_id,
            Transaction.categorization_status == CategorizationStatus.needs_review,
            Transaction.category_id.is_(None),
            Transaction.suggested_category_id == suggested_category_id,
        )
        .values(
            category_id=suggested_category_id,
            categorization_status=CategorizationStatus.done,
            categorization_source=CategorizationSource.llm_confirmed,
        )
        .returning(Transaction.id)
    )
    updated_id = (await db.execute(statement)).scalar_one_or_none()
    if updated_id is None:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="The category suggestion was already changed"
        )

    await db.commit()
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id, Transaction.company_id == company_id
        )
    )
    return result.scalar_one()


@router.get("/{transaction_id}", response_model=TransactionRead)
async def get_transaction(
    transaction_id: UUID,
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(get_current_company_member),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id, Transaction.company_id == company_id
        )
    )
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction


@router.patch("/{transaction_id}", response_model=TransactionRead)
async def update_transaction(
    transaction_id: UUID,
    company_id: UUID,
    payload: TransactionUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_any_permission(Permission.transaction_manage, Permission.transaction_categorize)),
    redis: ArqRedis = Depends(get_arq_redis),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id, Transaction.company_id == company_id
        )
    )
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    changes = payload.model_dump(exclude_unset=True)
    if (
        Permission.transaction_manage not in ROLE_PERMISSIONS[member.role]
        and (set(changes) != {"category_id"} or changes["category_id"] is None)
    ):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this transaction")
    if any(field in changes and changes[field] is None for field in ("date", "amount")):
        raise HTTPException(status_code=422, detail="Date and amount cannot be null")

    new_amount = changes.get("amount", transaction.amount)
    category_kind = category_kind_for_amount(new_amount)
    category_was_set = "category_id" in changes
    new_category_id = changes.get("category_id", transaction.category_id)

    if new_category_id is not None and (category_was_set or "amount" in changes):
        await validate_category_scope(
            db, company_id, new_category_id, expected_kind=category_kind
        )

    for field, value in changes.items():
        setattr(transaction, field, value)

    should_enqueue = False
    if category_was_set:
        if new_category_id is not None:
            transaction.categorization_status = CategorizationStatus.done
            transaction.categorization_source = CategorizationSource.user
        else:
            transaction.categorization_source = None
            transaction.suggested_category_id = None
            transaction.suggestion_confidence = None
            if category_kind is None:
                transaction.categorization_status = CategorizationStatus.needs_review
            else:
                transaction.categorization_status = CategorizationStatus.pending
                should_enqueue = True
    elif "amount" in changes or "description" in changes:
        if new_category_id is None:
            transaction.categorization_source = None
            transaction.suggested_category_id = None
            transaction.suggestion_confidence = None
            if category_kind is None:
                transaction.categorization_status = CategorizationStatus.needs_review
            else:
                transaction.categorization_status = CategorizationStatus.pending
                should_enqueue = True
        elif "amount" in changes:
            transaction.categorization_status = CategorizationStatus.done
            transaction.categorization_source = CategorizationSource.user

    await db.commit()
    await db.refresh(transaction)
    if should_enqueue:
        await _enqueue_categorization(
            redis, transaction.id, request.state.request_id
        )
    return transaction


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(
    transaction_id: UUID,
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_permission(Permission.transaction_manage)),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id, Transaction.company_id == company_id
        )
    )
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    await db.delete(transaction)
    await db.commit()
    return None
