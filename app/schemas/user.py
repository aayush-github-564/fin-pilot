import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict


class UserRead(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str | None
    avatar_url: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
