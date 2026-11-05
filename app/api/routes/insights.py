from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_arq_redis, get_current_company_member, get_db
from app.core.config import settings
from app.models.company_member import CompanyMember
from app.schemas.insights import SpendingAnomalyReportRead
from app.services.anomaly_detection import (
    detect_spending_anomalies,
    deterministic_explanation,
    explain_detected_anomalies,
    resolve_date_windows,
)

router = APIRouter(prefix="/companies/{company_id}/insights", tags=["insights"])
logger = logging.getLogger(__name__)


async def _allow_model_explanation(
    redis: ArqRedis, *, company_id: UUID, user_id: UUID
) -> bool:
    now = time.time()
    bucket = int(now // 60)
    key = f"anomaly-explanation:{company_id}:{user_id}:{bucket}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 120)
    except Exception as error:
        logger.warning(
            "Anomaly explanation rate limiter unavailable; using deterministic text",
            extra={
                "company_id": str(company_id),
                "user_id": str(user_id),
                "error_type": type(error).__name__,
            },
        )
        return False
    return count <= settings.anomaly_max_explanations_per_minute


@router.get("/anomalies", response_model=SpendingAnomalyReportRead)
async def get_spending_anomalies(
    company_id: UUID,
    request: Request,
    days: int = Query(default=30, ge=1, le=90),
    baseline_days: int = Query(default=180, ge=30, le=730),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
    redis: ArqRedis = Depends(get_arq_redis),
) -> SpendingAnomalyReportRead:
    authorized_company_id = membership.company_id
    authorized_user_id = membership.user_id
    windows = resolve_date_windows(days=days, baseline_days=baseline_days)
    try:
        report = await detect_spending_anomalies(
            db, company_id=authorized_company_id, windows=windows
        )
        await db.commit()
    except Exception as error:
        await db.rollback()
        logger.error(
            "Anomaly scan failed",
            extra={
                "request_id": getattr(request.state, "request_id", None),
                "company_id": str(authorized_company_id),
                "user_id": str(authorized_user_id),
                "error_type": type(error).__name__,
            },
        )
        raise HTTPException(
            status_code=503,
            detail="Anomaly scan is temporarily unavailable",
        ) from error

    anomalies: list[dict[str, Any]] = report["anomalies"]
    for anomaly in anomalies:
        anomaly["explanation"] = deterministic_explanation(anomaly)
        anomaly["explanation_source"] = "deterministic"

    if anomalies and await _allow_model_explanation(
        redis, company_id=authorized_company_id, user_id=authorized_user_id
    ):
        client: Any = getattr(request.app.state, "chat_client", None)
        if client is not None:
            started = time.perf_counter()
            try:
                explanations = await explain_detected_anomalies(
                    client,
                    model=settings.anomaly_explanation_model,
                    anomalies=anomalies,
                )
                if explanations is not None:
                    for index, explanation in explanations.items():
                        anomalies[index]["explanation"] = explanation
                        anomalies[index]["explanation_source"] = "llm"
                logger.info(
                    "Anomaly explanations generated",
                    extra={
                        "request_id": getattr(request.state, "request_id", None),
                        "company_id": str(authorized_company_id),
                        "user_id": str(authorized_user_id),
                        "anomaly_count": len(anomalies),
                        "explanation_source": "llm" if explanations is not None else "deterministic",
                        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
            except Exception as error:
                logger.warning(
                    "Anomaly explanation model request failed; using deterministic text",
                    extra={
                        "request_id": getattr(request.state, "request_id", None),
                        "company_id": str(authorized_company_id),
                        "user_id": str(authorized_user_id),
                        "anomaly_count": len(anomalies),
                        "error_type": type(error).__name__,
                        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )

    return SpendingAnomalyReportRead(
        window_start=windows.window_start,
        window_end=windows.window_end,
        baseline_start=windows.baseline_start,
        baseline_end=windows.baseline_end,
        anomalies_truncated=report["anomalies_truncated"],
        **{
            key: value
            for key, value in report.items()
            if key not in {"anomalies_truncated", "anomalies"}
        },
        anomalies=anomalies,
    )
