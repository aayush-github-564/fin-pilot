from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core import security

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _key_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def _claims(**overrides: object) -> dict[str, object]:
    claims: dict[str, object] = {
        "sub": str(uuid4()),
        "email": "verified@example.com",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": "https://example.supabase.co/auth/v1",
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    claims.update(overrides)
    return claims


class FakeJwksClient:
    def __init__(self, public_key: object):
        self.public_key = public_key

    def get_signing_key_from_jwt(self, token: str):
        return type("SigningKey", (), {"key": self.public_key})()


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": datetime.now(UTC) - timedelta(minutes=1)},
        {"aud": "other"},
        {"iss": "https://wrong.example/auth/v1"},
        {"role": "anon"},
        {"sub": "not-a-uuid"},
    ],
)
async def test_rejects_invalid_supabase_claims(monkeypatch, overrides) -> None:
    private_key, public_key = _key_pair()
    monkeypatch.setattr(security.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(security.settings, "supabase_jwt_secret", None)
    monkeypatch.setattr(security, "_jwks_client", lambda: FakeJwksClient(public_key))
    token = jwt.encode(_claims(**overrides), private_key, algorithm="RS256")

    with pytest.raises(jwt.PyJWTError):
        await security.verify_supabase_access_token(token)


async def test_rejects_invalid_signature_without_network(monkeypatch) -> None:
    signing_key, _ = _key_pair()
    _, trusted_key = _key_pair()
    monkeypatch.setattr(security.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(security.settings, "supabase_jwt_secret", None)
    monkeypatch.setattr(security, "_jwks_client", lambda: FakeJwksClient(trusted_key))
    token = jwt.encode(_claims(), signing_key, algorithm="RS256")

    with pytest.raises(jwt.PyJWTError):
        await security.verify_supabase_access_token(token)


async def test_accepts_valid_supabase_token_without_network(monkeypatch) -> None:
    private_key, public_key = _key_pair()
    expected = _claims()
    monkeypatch.setattr(security.settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(security.settings, "supabase_jwt_secret", None)
    monkeypatch.setattr(security, "_jwks_client", lambda: FakeJwksClient(public_key))
    token = jwt.encode(expected, private_key, algorithm="RS256")

    claims = await security.verify_supabase_access_token(token)

    assert claims["sub"] == expected["sub"]
