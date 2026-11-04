import logging
import uuid
from decimal import Decimal
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_arq_redis,
    get_current_company_member,
    get_db,
    require_role,
)
from app.models.category import CategoryKind
from app.models.company_member import CompanyMember
from app.models.transaction import (
    CategorizationSource,
    CategorizationStatus,
    Transaction,
)
from app.schemas.transaction import (
    TransactionCreate,
    TransactionRead,
    TransactionUpdate,
)
from app.services.categorization import category_kind_for_amount, resolve_category_id
from app.services.category_scope import validate_category_scope

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
            extra={"transaction_id": str(transaction_id)},
        )


@router.post("", response_model=TransactionRead, status_code=201)
async def create_transaction(
    company_id: uuid.UUID,
    payload: TransactionCreate,
    request: Request,
    membership: CompanyMember = Depends(require_role("owner", "accountant")),
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


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    company_id: uuid.UUID,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(Transaction.company_id == company_id)
        .order_by(
            Transaction.date.desc(),
            Transaction.created_at.desc(),
            Transaction.id,
        )
    )
    return result.scalars().all()


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


@router.post(
    "/{transaction_id}/accept-suggestion", response_model=TransactionRead
)
async def accept_transaction_suggestion(
    transaction_id: UUID,
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    member: CompanyMember = Depends(require_role("owner", "accountant")),
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
    member: CompanyMember = Depends(require_role("owner", "accountant")),
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
    member: CompanyMember = Depends(require_role("owner", "accountant")),
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
