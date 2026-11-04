from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

import anthropic
from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_arq_redis, get_current_company_member, get_db
from app.core.config import settings
from app.models.chat_query import ChatQuery
from app.models.company_member import CompanyMember
from app.schemas.chat import FinancialQueryRead, FinancialQueryRequest
from app.services.financial_qa import (
    QueryPlan,
    execute_plan,
    load_expense_categories,
    render_answer,
    resolve_period,
    select_plan,
)

router = APIRouter(prefix="/companies/{company_id}/chat", tags=["chat"])
logger = logging.getLogger(__name__)


async def _enforce_rate_limit(redis: ArqRedis, company_id: UUID, user_id: UUID) -> int:
    now = time.time()
    bucket = int(now // 60)
    key = f"financial-qa:{company_id}:{user_id}:{bucket}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 120)
    except Exception as error:
        logger.warning(
            "Financial Q&A rate limiter unavailable",
            extra={"company_id": str(company_id), "user_id": str(user_id), "error_type": type(error).__name__},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Financial Q&A is temporarily unavailable",
        ) from error
    if count > settings.financial_qa_max_queries_per_minute:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Financial Q&A rate limit exceeded",
            headers={"Retry-After": str(max(1, 60 - int(now % 60)))},
        )
    return count


def _unsupported_response(query_id: UUID) -> FinancialQueryRead:
    return FinancialQueryRead(
        query_id=query_id,
        supported=False,
        answer="I can answer questions about cash flow, expense categories, largest expenses, and this or last month's budgets.",
        query_type="unsupported",
        period=None,
        start_date=None,
        end_date=None,
        facts={},
    )


@router.post("/query", response_model=FinancialQueryRead)
async def ask_financial_question(
    company_id: UUID,
    request_body: FinancialQueryRequest,
    request: Request,
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
) -> FinancialQueryRead:
    authorized_company_id = membership.company_id
    authorized_user_id = membership.user_id
    await _enforce_rate_limit(redis, authorized_company_id, authorized_user_id)

    audit = ChatQuery(
        company_id=authorized_company_id,
        user_id=authorized_user_id,
        natural_language_query=request_body.question,
        generated_sql=None,
        executed=False,
    )
    db.add(audit)
    await db.commit()
    await db.refresh(audit)
    audit_id = audit.id

    category_names, category_by_name = await load_expense_categories(
        db, authorized_company_id
    )
    # Release the read transaction and connection before waiting on Anthropic.
    await db.commit()
    client: Any = getattr(request.app.state, "chat_client", None)
    if client is None:
        audit.error_code = "model_unavailable"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Financial Q&A is temporarily unavailable",
        )

    started = time.perf_counter()
    try:
        plan_result = await select_plan(
            client,
            model=settings.financial_qa_model,
            question=request_body.question,
            category_names=category_names,
        )
    except (anthropic.APIError, TimeoutError) as error:
        audit.error_code = "model_unavailable"
        await db.commit()
        logger.warning(
            "Financial Q&A model request failed",
            extra={
                "query_id": str(audit.id),
                "company_id": str(authorized_company_id),
                "user_id": str(authorized_user_id),
                "error_type": type(error).__name__,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Financial Q&A is temporarily unavailable",
        ) from error

    if plan_result.plan is None:
        audit.error_code = "invalid_plan"
        audit.query_plan = None
        await db.commit()
        logger.info(
            "Financial Q&A plan rejected",
            extra={
                "query_id": str(audit.id),
                "company_id": str(authorized_company_id),
                "user_id": str(authorized_user_id),
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                "input_tokens": plan_result.input_tokens,
                "output_tokens": plan_result.output_tokens,
            },
        )
        return _unsupported_response(audit.id)

    plan: QueryPlan = plan_result.plan
    audit.query_plan = plan.as_dict()
    if plan.query_type == "unsupported":
        audit.error_code = "unsupported"
        await db.commit()
        return _unsupported_response(audit.id)

    bounds = resolve_period(plan.period)
    try:
        facts = await execute_plan(
            db,
            company_id=authorized_company_id,
            plan=plan,
            category_by_name=category_by_name,
            bounds=bounds,
        )
    except Exception as error:
        await db.rollback()
        audit = await db.get(ChatQuery, audit_id)
        if audit is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Financial query could not be completed",
            ) from error
        audit.error_code = "query_failed"
        audit.query_plan = plan.as_dict()
        await db.commit()
        logger.error(
            "Financial Q&A query failed",
            extra={
                "query_id": str(audit.id),
                "company_id": str(authorized_company_id),
                "user_id": str(authorized_user_id),
                "query_type": plan.query_type,
                "period": plan.period,
                "error_type": type(error).__name__,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Financial query could not be completed",
        ) from error

    audit.executed = True
    audit.error_code = None
    audit.result_data = facts
    await db.commit()
    logger.info(
        "Financial Q&A query completed",
        extra={
            "query_id": str(audit.id),
            "company_id": str(authorized_company_id),
            "user_id": str(authorized_user_id),
            "query_type": plan.query_type,
            "period": plan.period,
            "executed": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "input_tokens": plan_result.input_tokens,
            "output_tokens": plan_result.output_tokens,
        },
    )
    return FinancialQueryRead(
        query_id=audit.id,
        supported=True,
        answer=render_answer(plan.query_type, facts, bounds),
        query_type=plan.query_type,
        period=plan.period,
        start_date=bounds.start,
        end_date=bounds.end,
        facts=facts,
    )
