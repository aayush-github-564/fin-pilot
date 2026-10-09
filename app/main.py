from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI

from app.api.routes.auth import router as auth_router
from app.api.routes.budgets import router as budgets_router
from app.api.routes.categories import router as categories_router
from app.api.routes.companies import router as companies_router
from app.api.routes.invoices import router as invoices_router
from app.api.routes.transactions import router as transactions_router
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Opens once when the API starts — the "phone line" to Redis stays open
    # for the app's whole life, reused by every request instead of
    # reconnecting each time.
    app.state.redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    yield
    await app.state.redis.close()


app = FastAPI(title="FinPilot", lifespan=lifespan)

API_V1_PREFIX = "/api/v1"

app.include_router(auth_router, prefix=API_V1_PREFIX)
app.include_router(companies_router, prefix=API_V1_PREFIX)
app.include_router(categories_router, prefix=API_V1_PREFIX)
app.include_router(transactions_router, prefix=API_V1_PREFIX)
app.include_router(invoices_router, prefix=API_V1_PREFIX)
app.include_router(budgets_router, prefix=API_V1_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}
