import uuid
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile

from app.core.config import settings

UPLOAD_ROOT = Path(settings.upload_dir)


async def save_file(
    upload_file: UploadFile,
    company_id: UUID,
    *,
    extension: str | None = None,
) -> str:
    """
    Saves an uploaded file to local disk and returns a reference string
    to store in the database (Invoice.file_reference).

    Layout: uploads/{company_id}/{uuid}{original_extension}
    This mirrors what an S3 key would look like (bucket/company_id/uuid.ext) —
    swapping to S3 later means rewriting what's INSIDE this function,
    nothing that calls it has to change.
    """
    company_dir = UPLOAD_ROOT / str(company_id)
    company_dir.mkdir(parents=True, exist_ok=True)

    extension = extension if extension is not None else Path(upload_file.filename).suffix
    stored_name = f"{uuid.uuid4()}{extension}"
    destination = company_dir / stored_name

    contents = await upload_file.read()
    destination.write_bytes(contents)

    return f"{company_id}/{stored_name}"


def get_file_path(file_reference: str) -> Path:
    """
    Resolves a stored file_reference back to an absolute path on disk.
    The extraction worker will use this to actually open the file.
    """
    return UPLOAD_ROOT / file_reference


def resolve_file_path(file_reference: str) -> Path:
    """Resolve an existing stored file while preventing traversal outside uploads."""
    upload_root = UPLOAD_ROOT.resolve()
    resolved = get_file_path(file_reference).resolve(strict=True)
    try:
        resolved.relative_to(upload_root)
    except ValueError as error:
        raise ValueError("Stored file reference escapes the upload directory") from error
    if not resolved.is_file():
        raise FileNotFoundError("Stored upload is not a regular file")
    return resolved
