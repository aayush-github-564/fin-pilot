"""Report local accounts that predate Supabase Auth; this script never mutates data."""

import asyncio

from sqlalchemy import func, select

from app.core.db import AsyncSessionLocal, engine
from app.models import User


async def main() -> None:
    async with AsyncSessionLocal() as session:
        total = int(await session.scalar(select(func.count(User.id))) or 0)
        legacy_count = int(
            await session.scalar(
                select(func.count(User.id)).where(User.auth_user_id.is_(None))
            )
            or 0
        )
        result = await session.execute(
            select(User.id, User.email)
            .where(User.auth_user_id.is_(None))
            .order_by(User.created_at, User.id)
        )
        legacy_accounts = result.all()

    print(f"Accounts: {total}; legacy accounts without a Supabase identity: {legacy_count}.")
    for user_id, email in legacy_accounts:
        print(f"{user_id}  {email}")
    print("No data was changed. Review these accounts before any cleanup or relinking.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
