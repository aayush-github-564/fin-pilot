from fastapi import FastAPI

from app.api.routes.auth import router as auth_router
from app.api.routes.budgets import router as budgets_router
from app.api.routes.categories import router as categories_router
from app.api.routes.companies import router as companies_router
from app.api.routes.invoices import router as invoices_router
from app.api.routes.transactions import router as transactions_router

app = FastAPI(title="FinPilot")

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
