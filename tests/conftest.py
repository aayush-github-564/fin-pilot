from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

# Set these before any application modules are imported during test collection.
os.environ["SECRET_KEY"] = "pytest-only-secret-key"
os.environ["ANTHROPIC_API_KEY"] = "pytest-only-not-a-real-api-key"
os.environ["REDIS_URL"] = "redis://127.0.0.1:6379/15"
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://finpilot:finpilot@127.0.0.1:5432/finpilot_test",
)

from sqlalchemy import text
from sqlalchemy.engine import URL, make_url

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


TEST_DATABASE_URL = os.environ["DATABASE_URL"]
_database_url = make_url(TEST_DATABASE_URL)
if not _database_url.database or not _database_url.database.endswith("_test"):
    raise RuntimeError(
        "Refusing to run tests: DATABASE_URL must name a database ending in '_test'."
    )
if _database_url.drivername != "postgresql+asyncpg":
    raise RuntimeError(
        "Refusing to run tests: DATABASE_URL must use the postgresql+asyncpg driver."
    )


def _ensure_test_database() -> None:
    """Create the configured *_test database through PostgreSQL's maintenance DB."""
    import psycopg2
    from psycopg2 import sql

    admin_url: URL = _database_url.set(
        drivername="postgresql", database="postgres"
    )
    conn = psycopg2.connect(admin_url.render_as_string(hide_password=False))
    try:
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s",
                (_database_url.database,),
            )
            exists = cursor.fetchone() is not None
            if not exists:
                cursor.execute(
                    sql.SQL("CREATE DATABASE {}").format(
                        sql.Identifier(_database_url.database)
                    )
                )
    finally:
        conn.close()
    state = "already exists" if exists else "created"
    print(f"Test database '{_database_url.database}' {state}.")


def pytest_sessionstart(session: pytest.Session) -> None:
    # A second guard lives here immediately before any database operation.
    if not _database_url.database or not _database_url.database.endswith("_test"):
        raise RuntimeError("Refusing database setup: target name must end in '_test'.")

    _ensure_test_database()
    print("Applying Alembic migrations to head on the test database.")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        env=os.environ.copy(),
    )


@dataclass(frozen=True)
class TestActor:
    user_id: UUID
    company_id: UUID
    role: str
    headers: dict[str, str]


class FakeArqPool:
    """In-memory arq pool that captures job submissions without opening Redis."""

    def __init__(self) -> None:
        self.jobs: list[dict[str, object]] = []
        self.closed = False

    async def enqueue_job(
        self, function_name: str, *args: object, _job_id: str | None = None, **kwargs: object
    ) -> dict[str, object]:
        job = {
            "function_name": function_name,
            "args": args,
            "job_id": _job_id,
        }
        self.jobs.append(job)
        return job

    async def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def forbid_real_anthropic_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make any Anthropic SDK API request fail immediately in every test."""
    from anthropic._base_client import AsyncAPIClient

    async def fail_real_call(self: object, *args: object, **kwargs: object) -> None:
        raise AssertionError("A real Anthropic API call is forbidden in tests.")

    monkeypatch.setattr(AsyncAPIClient, "request", fail_real_call)


async def _truncate_test_tables() -> None:
    from app.core.db import engine

    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
            )
        )
        table_names = result.scalars().all()
        if table_names:
            quote = connection.dialect.identifier_preparer.quote
            names = ", ".join(
                f"{quote('public')}.{quote(table_name)}" for table_name in table_names
            )
            await connection.execute(
                text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE")
            )


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def isolate_database_per_test() -> AsyncIterator[None]:
    # Routes commit their own sessions, so rollback cannot isolate API requests.
    # Reset before and after each test, preserving Alembic's version marker.
    await _truncate_test_tables()
    yield
    await _truncate_test_tables()


@pytest_asyncio.fixture(scope="session", autouse=True, loop_scope="session")
async def dispose_async_engine_after_session() -> AsyncIterator[None]:
    yield
    from app.core.db import engine

    await engine.dispose()


@pytest.fixture
def fake_arq_pool() -> FakeArqPool:
    return FakeArqPool()


@pytest_asyncio.fixture(loop_scope="session")
async def async_client(fake_arq_pool: FakeArqPool) -> AsyncIterator[AsyncClient]:
    from fastapi import FastAPI
    from app.main import app

    @asynccontextmanager
    async def fake_lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.redis = fake_arq_pool
        yield
        await fake_arq_pool.close()

    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = fake_lifespan
    try:
        async with app.router.lifespan_context(app):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                yield client
    finally:
        app.router.lifespan_context = original_lifespan


@pytest_asyncio.fixture(loop_scope="session")
async def actor_factory() -> Callable[[Literal["owner", "accountant", "viewer"]], object]:
    async def create_actor(role: Literal["owner", "accountant", "viewer"]) -> TestActor:
        from app.core.db import AsyncSessionLocal
        from app.core.security import create_access_token
        from app.models import Company, CompanyMember, CompanyRole, User

        user = User(
            email=f"{role}-{uuid4()}@example.com",
            hashed_password="not-used-by-this-fixture",
        )
        company = Company(name=f"Test company for {role}")
        async with AsyncSessionLocal() as session:
            session.add_all([user, company])
            await session.flush()
            session.add(
                CompanyMember(
                    user_id=user.id,
                    company_id=company.id,
                    role=CompanyRole(role),
                )
            )
            await session.commit()

        token = create_access_token(user.id)
        return TestActor(
            user_id=user.id,
            company_id=company.id,
            role=role,
            headers={"Authorization": f"Bearer {token}"},
        )

    return create_actor


@pytest_asyncio.fixture(loop_scope="session")
async def transaction_factory() -> Callable[[TestActor], object]:
    async def create_transaction(actor: TestActor) -> UUID:
        from app.core.db import AsyncSessionLocal
        from app.models import Category, Transaction, TransactionSource

        category = Category(company_id=actor.company_id, name="Test expense")
        async with AsyncSessionLocal() as session:
            session.add(category)
            await session.flush()
            transaction = Transaction(
                company_id=actor.company_id,
                date=date(2026, 1, 2),
                amount=Decimal("-12.50"),
                description="Test expense",
                category_id=category.id,
                source=TransactionSource.manual,
            )
            session.add(transaction)
            transaction_id = transaction.id
            await session.commit()
        return transaction_id

    return create_transaction
