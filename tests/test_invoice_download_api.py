from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _create_invoice(company_id: Any, file_reference: str | None) -> Any:
    from app.core.db import AsyncSessionLocal
    from app.models import Invoice

    async with AsyncSessionLocal() as session:
        invoice = Invoice(company_id=company_id, file_reference=file_reference)
        session.add(invoice)
        await session.commit()
        return invoice.id


async def test_member_can_download_company_scoped_invoice_file(
    async_client: AsyncClient,
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    owner = await actor_factory("owner")
    stranger = await actor_factory("viewer")
    monkeypatch.setattr("app.services.storage.UPLOAD_ROOT", tmp_path)
    stored_path = tmp_path / str(owner.company_id) / f"{uuid4()}.pdf"
    stored_path.parent.mkdir(parents=True)
    stored_path.write_bytes(b"sample invoice pdf")
    invoice_id = await _create_invoice(
        owner.company_id,
        f"{owner.company_id}/{stored_path.name}",
    )
    url = (
        f"/api/v1/companies/{owner.company_id}/invoices/"
        f"{invoice_id}/download"
    )

    downloaded = await async_client.get(url, headers=owner.headers)
    forbidden = await async_client.get(url, headers=stranger.headers)

    assert downloaded.status_code == 200
    assert downloaded.content == b"sample invoice pdf"
    assert downloaded.headers["content-type"] == "application/pdf"
    assert "attachment; filename=\"invoice-" in downloaded.headers[
        "content-disposition"
    ]
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert forbidden.status_code == 403


async def test_invoice_download_hides_missing_and_unsafe_references(
    async_client: AsyncClient,
    actor_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    owner = await actor_factory("owner")
    monkeypatch.setattr("app.services.storage.UPLOAD_ROOT", tmp_path)
    outside_file = tmp_path.parent / f"{uuid4()}.pdf"
    outside_file.write_bytes(b"must not be served")
    unsafe_reference = f"../{outside_file.name}"
    invoice_id = await _create_invoice(owner.company_id, unsafe_reference)
    url = (
        f"/api/v1/companies/{owner.company_id}/invoices/"
        f"{invoice_id}/download"
    )

    response = await async_client.get(url, headers=owner.headers)

    assert response.status_code == 404
