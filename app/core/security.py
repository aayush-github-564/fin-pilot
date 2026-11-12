import asyncio
from functools import lru_cache
from uuid import UUID

import jwt
from jwt import PyJWKClient, PyJWTError

from app.core.config import settings

@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required to validate access tokens")
    return PyJWKClient(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=300,
        timeout=5,
    )


def _decode_supabase_token(token: str) -> dict[str, object]:
    issuer = f"{(settings.supabase_url or '').rstrip('/')}/auth/v1"
    header = jwt.get_unverified_header(token)
    algorithm = header.get("alg")
    if settings.supabase_jwt_secret is not None:
        if algorithm != "HS256":
            raise PyJWTError("Unsupported legacy JWT algorithm")
        key = settings.supabase_jwt_secret.get_secret_value()
    else:
        if algorithm not in {"RS256", "ES256"}:
            raise PyJWTError("Unsupported asymmetric JWT algorithm")
        key = _jwks_client().get_signing_key_from_jwt(token).key

    claims = jwt.decode(
        token,
        key,
        algorithms=[algorithm],
        audience="authenticated",
        issuer=issuer,
        options={"require": ["exp", "iss", "aud", "sub"]},
    )
    try:
        UUID(claims["sub"])
    except (ValueError, TypeError, KeyError) as error:
        raise PyJWTError("Invalid subject") from error
    if claims.get("role") != "authenticated":
        raise PyJWTError("Token is not for an authenticated user")
    return claims


async def verify_supabase_access_token(token: str) -> dict[str, object]:
    return await asyncio.to_thread(_decode_supabase_token, token)
