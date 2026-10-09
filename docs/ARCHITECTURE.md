# FinPilot Architecture

Repository facts below were checked against the source and configuration. Historical runtime notes and broader AI guardrails are labeled **Handoff** because they cannot be established from code alone.

## Stack and components

- **API — verified:** FastAPI with Pydantic v2 schemas; routes are mounted under `/api/v1`.
- **Data — verified:** PostgreSQL-oriented SQLAlchemy models and async sessions, `asyncpg`, and Alembic migrations. The Compose database image is PostgreSQL 16.
- **Jobs — verified:** Redis and an arq worker. Compose defines PostgreSQL, Redis, and the worker; it does not define an API service.
- **LLM — verified:** The invoice worker calls Anthropic's `claude-haiku-4-5-20251001` model for document/image extraction.
- **Storage — verified:** Uploaded files are written to a local upload directory; the database stores a file reference. The service boundary is intended to make a future storage-backend change local to that service.
- **Auth — verified:** JWT-based authentication using the configured security dependencies; company memberships carry owner, accountant, or viewer roles.

**Configuration concern:** `pyproject.toml` requires Python `>=3.13`, while the worker Dockerfile starts from Python `3.12-slim`. Container build/runtime compatibility has not been verified.

## Current request and job flows

1. Authenticated requests use company membership dependencies for company-scoped endpoints. Resource queries include the company ID in the repository code.
2. Invoice upload stores the file locally, creates an invoice row, and enqueues `extract_invoice` through Redis/arq.
3. The worker reads the referenced file, sends it to Anthropic, parses the returned vendor, amount, and date, and updates the invoice processing status. Missing extracted values may remain null while the job is marked complete; parse or API errors are caught and recorded as failed.
4. Transaction creation runs keyword-based categorization and looks up a matching global category when one is found. There is no LLM categorization fallback in the current code.

The `ChatQuery` model exists, but no query agent or chat route was found. Dashboard aggregation, anomaly detection, digest generation, and CSV ingestion were also not found.

## Repository structure

```text
app/
  api/routes/       FastAPI auth, company, category, transaction, invoice, budget routes
  core/             settings, database, and security setup
  models/           SQLAlchemy entities, including ChatQuery
  schemas/          Pydantic request/response schemas
  scripts/          category seed script
  services/         local file storage and rule-based categorization
  worker.py         arq tasks, including invoice extraction
alembic/            schema migration scripts
docs/               requirements, architecture, engineering, learning, and handoff docs
docker-compose.yml  PostgreSQL, Redis, and worker services
```

## Design decisions and boundaries

- **Verified implementation / Handoff intent:** PostgreSQL is the source of persisted financial records; application code performs extraction parsing and persistence. The handoff's broader rule that LLMs never calculate or write to the database is a project constraint to preserve.
- **Handoff decision:** arq was selected for asynchronous work; local storage is the current backend, with S3 considered later. The handoff says the API runs natively on Windows while infrastructure and the worker run in Docker. Compose confirms there is no API service, but the actual host runtime was not tested.
- **Handoff decision:** Future AI features should use company-scoped, restricted data access and deterministic calculations. These features are not yet implemented.
- **Verified concern:** Membership is checked on resource creation, but several create routes do not require an owner/accountant role. Apply the intended role policy consistently before expanding write capabilities.

Migration files exist in the repository. Whether they have been applied to any database is unresolved.
