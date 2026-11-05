"""Export the FastAPI contract for frontend type generation."""

import json
import os
from pathlib import Path

# OpenAPI generation does not start the app or connect to its providers. Supply
# harmless local-only defaults so this script also runs without a populated .env.
for key, value in {
    "DATABASE_URL": "postgresql+asyncpg://openapi:openapi@localhost/openapi",
    "REDIS_URL": "redis://localhost:6379/0",
    "SECRET_KEY": "openapi-generation-only",
    "ANTHROPIC_API_KEY": "openapi-generation-only",
}.items():
    os.environ.setdefault(key, value)

from app.main import app  # noqa: E402


def main() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    output_path = repository_root / "frontend" / "openapi.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output_path.relative_to(repository_root)}")


if __name__ == "__main__":
    main()
