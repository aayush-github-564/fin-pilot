from __future__ import annotations

import asyncio
import hashlib
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture(autouse=True)
def stub_csv_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_save_file(
        upload_file: Any,
        company_id: Any,
        *,
        extension: str | None = None,
    ) -> str:
        content = await upload_file.read()
        digest = hashlib.sha256(content).hexdigest()
        return f"{company_id}/test-{digest}{extension or '.csv'}"

    monkeypatch.setattr("app.api.routes.transactions.save_file", fake_save_file)


async def _add_global_category(name: str, kind: str = "expense") -> UUID:
    from app.core.db import AsyncSessionLocal
    from app.models import Category, CategoryKind

    async with AsyncSessionLocal() as session:
        category = Category(
            company_id=None,
            name=name,
            kind=CategoryKind(kind),
        )
        session.add(category)
        await session.commit()
        return category.id


def _csv_file(content: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": ("statement.csv", content.encode(), "text/csv")}


async def test_csv_import_returns_row_results_and_replay_is_idempotent(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
) -> None:
    from app.core.db import AsyncSessionLocal
    from app.models import CategorizationStatus, Transaction, TransactionSource

    owner = await actor_factory("owner")
    travel_id = await _add_global_category("Travel")
    content = (
        "Date,Description,Amount,Reference\n"
        "2026-01-05,Hotel - client travel,-118.00,TX-1\n"
        "2026-01-06,Unmatched expense,-20.00,TX-2\n"
        "2026-01-07,Customer payment,125.00,TX-3\n"
        "2026-01-08,Duplicate transaction reference,125.00,TX-3\n"
        "not-a-date,Invalid row,5.00,TX-4\n"
    )
    url = f"/api/v1/companies/{owner.company_id}/transactions/import-csv"

    response = await async_client.post(
        url, headers=owner.headers, files=_csv_file(content)
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (
        body["rows_seen"],
        body["imported_count"],
        body["duplicate_count"],
        body["rejected_count"],
    ) == (5, 3, 1, 1)
    assert [row["status"] for row in body["rows"]] == [
        "imported",
        "imported",
        "imported",
        "duplicate",
        "rejected",
    ]
    assert body["rows"][0]["categorization_status"] == "done"
    assert body["rows"][0]["transaction_id"]
    assert body["rows"][4]["error_code"] == "invalid_date"
    assert len(fake_arq_pool.jobs) == 2

    transaction_ids = [UUID(row["transaction_id"]) for row in body["rows"][:3]]
    async with AsyncSessionLocal() as session:
        transactions = (
            await session.scalars(
                select(Transaction)
                .where(Transaction.id.in_(transaction_ids))
                .order_by(Transaction.date)
            )
        ).all()
        assert len(transactions) == 3
        assert transactions[0].category_id == travel_id
        assert transactions[0].categorization_source.value == "rule"
        assert all(transaction.source == TransactionSource.upload for transaction in transactions)
        assert transactions[0].raw_reference.startswith(
            f"csv:{owner.company_id}/test-"
        )
        assert transactions[0].raw_reference.endswith("#record=2")
        assert transactions[1].categorization_status == CategorizationStatus.pending
        assert transactions[2].amount == Decimal("125.00")

    replay = await async_client.post(
        url, headers=owner.headers, files=_csv_file(content)
    )

    assert replay.status_code == 200
    assert replay.json()["imported_count"] == 0
    assert replay.json()["duplicate_count"] == 4
    assert replay.json()["rejected_count"] == 1
    assert len(fake_arq_pool.jobs) == 2


async def test_csv_dedupes_by_bank_reference_and_scopes_reference_per_company(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    other_owner = await actor_factory("owner")
    first_content = "Date,Description,Amount,Reference\n2026-01-05,Purchase,-10.00,ABC 123\n"
    first_url = f"/api/v1/companies/{owner.company_id}/transactions/import-csv"
    first = await async_client.post(
        first_url, headers=owner.headers, files=_csv_file(first_content)
    )
    assert first.status_code == 200

    changed_export = (
        "Transaction Date,Details,Transaction Amount,Reference Number\n"
        "2026-01-05,Updated merchant text,-10.00,abc 123\n"
    )
    duplicate = await async_client.post(
        first_url, headers=owner.headers, files=_csv_file(changed_export)
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate_count"] == 1
    assert duplicate.json()["rows"][0]["transaction_id"] == first.json()["rows"][0][
        "transaction_id"
    ]

    other_url = (
        f"/api/v1/companies/{other_owner.company_id}/transactions/import-csv"
    )
    other_company_import = await async_client.post(
        other_url, headers=other_owner.headers, files=_csv_file(changed_export)
    )
    assert other_company_import.status_code == 200
    assert other_company_import.json()["imported_count"] == 1


async def test_identical_rows_without_bank_ids_are_not_collapsed(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    owner = await actor_factory("owner")
    content = (
        "Date,Description,Amount\n"
        "2026-01-05,Coffee shop,-5.00\n"
        "2026-01-05,Coffee shop,-5.00\n"
    )

    response = await async_client.post(
        f"/api/v1/companies/{owner.company_id}/transactions/import-csv",
        headers=owner.headers,
        files=_csv_file(content),
    )

    assert response.status_code == 200
    assert response.json()["imported_count"] == 2
    assert response.json()["duplicate_count"] == 0
    assert response.json()["rows"][0]["transaction_id"] != response.json()["rows"][1][
        "transaction_id"
    ]


async def test_viewer_cannot_import_csv(
    async_client: AsyncClient, actor_factory: Any
) -> None:
    viewer = await actor_factory("viewer")

    response = await async_client.post(
        f"/api/v1/companies/{viewer.company_id}/transactions/import-csv",
        headers=viewer.headers,
        files=_csv_file("Date,Description,Amount\n2026-01-05,x,1.00\n"),
    )

    assert response.status_code == 403


async def test_concurrent_replays_insert_once_and_enqueue_once(
    async_client: AsyncClient,
    actor_factory: Any,
    fake_arq_pool: Any,
) -> None:
    owner = await actor_factory("owner")
    url = f"/api/v1/companies/{owner.company_id}/transactions/import-csv"
    files = _csv_file(
        "Date,Description,Amount\n2026-01-05,Unmatched purchase,-18.00\n"
    )

    responses = await asyncio.gather(
        async_client.post(url, headers=owner.headers, files=files),
        async_client.post(url, headers=owner.headers, files=files),
    )

    assert [response.status_code for response in responses] == [200, 200]
    assert sum(response.json()["imported_count"] for response in responses) == 1
    assert sum(response.json()["duplicate_count"] for response in responses) == 1
    assert len(fake_arq_pool.jobs) == 1
