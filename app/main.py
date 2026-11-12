from contextlib import asynccontextmanager
import logging
import time
from uuid import uuid4

from arq import create_pool
from arq.connections import RedisSettings
import anthropic
from fastapi import FastAPI, Request

from app.api.routes.auth import router as auth_router
from app.api.routes.budgets import router as budgets_router
from app.api.routes.chat import router as chat_router
from app.api.routes.categories import router as categories_router
from app.api.routes.companies import router as companies_router
from app.api.routes.digests import router as digests_router
from app.api.routes.invoices import router as invoices_router
from app.api.routes.insights import router as insights_router
from app.api.routes.metrics import router as metrics_router
from app.api.routes.memberships import router as memberships_router
from app.api.routes.transactions import router as transactions_router
from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Opens once when the API starts — the "phone line" to Redis stays open
    # for the app's whole life, reused by every request instead of
    # reconnecting each time.
    app.state.redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    app.state.chat_client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        max_retries=0,
        timeout=30.0,
    )
    yield
    await app.state.chat_client.close()
    await app.state.redis.close()


app = FastAPI(title="FinPilot", lifespan=lifespan)

API_V1_PREFIX = "/api/v1"

app.include_router(auth_router, prefix=API_V1_PREFIX)
app.include_router(companies_router, prefix=API_V1_PREFIX)
app.include_router(categories_router, prefix=API_V1_PREFIX)
app.include_router(transactions_router, prefix=API_V1_PREFIX)
app.include_router(invoices_router, prefix=API_V1_PREFIX)
app.include_router(budgets_router, prefix=API_V1_PREFIX)
app.include_router(metrics_router, prefix=API_V1_PREFIX)
app.include_router(memberships_router, prefix=API_V1_PREFIX)
app.include_router(chat_router, prefix=API_V1_PREFIX)
app.include_router(insights_router, prefix=API_V1_PREFIX)
app.include_router(digests_router, prefix=API_V1_PREFIX)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = str(uuid4())
    request.state.request_id = request_id
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as error:
        logger.error(
            "HTTP request failed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "error_type": type(error).__name__,
            },
        )
        raise

    response.headers["X-Request-ID"] = request_id
    logger.info(
        "HTTP request completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "latency_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}
