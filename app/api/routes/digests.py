from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_company_member, get_db
from app.models.company_member import CompanyMember
from app.models.weekly_digest import WeeklyDigest, WeeklyDigestDelivery
from app.schemas.weekly_digest import WeeklyDigestRead

router = APIRouter(prefix="/companies/{company_id}/digests", tags=["digests"])


@router.get("/weekly", response_model=WeeklyDigestRead)
async def get_latest_weekly_digest(
    company_id: UUID,
    period_start: date | None = Query(default=None),
    membership: CompanyMember = Depends(get_current_company_member),
    db: AsyncSession = Depends(get_db),
) -> WeeklyDigestRead:
    if period_start is not None and period_start.weekday() != 0:
        raise HTTPException(status_code=422, detail="period_start must be a Monday")
    filters = [WeeklyDigest.company_id == membership.company_id]
    if period_start is not None:
        filters.append(WeeklyDigest.period_start == period_start)
    result = await db.execute(
        select(WeeklyDigest)
        .where(*filters)
        .order_by(WeeklyDigest.period_start.desc())
        .limit(1)
    )
    digest = result.scalar_one_or_none()
    if digest is None:
        raise HTTPException(status_code=404, detail="Weekly digest not found")

    delivery_result = await db.execute(
        select(WeeklyDigestDelivery.status).where(
            WeeklyDigestDelivery.digest_id == digest.id,
            WeeklyDigestDelivery.user_id == membership.user_id,
        )
    )
    return WeeklyDigestRead(
        id=digest.id,
        company_id=digest.company_id,
        period_start=digest.period_start,
        period_end=digest.period_end,
        summary=digest.summary,
        summary_source=digest.summary_source,
        facts=digest.facts,
        delivery_status=delivery_result.scalar_one_or_none(),
        created_at=digest.created_at,
    )
