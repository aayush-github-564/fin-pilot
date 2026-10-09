import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

UPLOAD_ROOT = Path(settings.upload_dir)


async def save_file(upload_file: UploadFile, company_id: int) -> str:
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

    extension = Path(upload_file.filename).suffix
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
