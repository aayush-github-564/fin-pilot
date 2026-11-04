# FinPilot Architecture

Repository facts below were checked against the source and configuration. Historical runtime notes and broader AI guardrails are labeled **Handoff** because they cannot be established from code alone.

## Stack and components

- **API — verified:** FastAPI with Pydantic v2 schemas; routes are mounted under `/api/v1`.
- **Data — verified:** PostgreSQL-oriented SQLAlchemy models and async sessions, `asyncpg`, and Alembic migrations. The Compose database image is PostgreSQL 16.
- **Jobs — verified:** Redis and an arq worker. Compose defines PostgreSQL, Redis, and the worker; it does not define an API service.
- **LLM — verified:** The invoice worker calls Anthropic's `claude-haiku-4-5-20251001` model for document/image extraction.
- **Storage — verified:** Uploaded files are written to a local upload directory; the database stores a file reference. The service boundary is intended to make a future storage-backend change local to that service.
- **Auth — verified:** JWT-based authentication using the configured security dependencies; company memberships carry owner, accountant, or viewer roles.

**Runtime alignment — verified:** `pyproject.toml` requires Python `>=3.13`, and the worker Dockerfile now uses Python 3.13. A Docker image build has not yet been run.

## Current request and job flows

1. Authenticated requests use company membership dependencies for company-scoped endpoints. Resource queries include the company ID in the repository code.
2. Invoice upload stores the file locally, creates an invoice row, and enqueues `extract_invoice` through Redis/arq.
3. The worker reads the referenced file, sends it to Anthropic, validates the JSON object and each extracted field, then persists parsed values. Parse or API errors are recorded as failed without persisting partially parsed fields. Missing values remain null and are logged for manual review; the status enum has no separate `needs_review` state yet.
4. Transaction creation runs whole-word, longest-keyword-first categorization and looks up a matching global category when one is found. Unmatched transactions can remain uncategorized. There is no LLM categorization fallback in the current code.
5. Transaction, invoice, budget, and category creation plus invoice upload require owner or accountant membership. Category references on transactions and budgets, and parent-category references, are restricted to global or same-company categories. Category reads include global defaults.

The `ChatQuery` model exists, but no query agent or chat route was found. Dashboard aggregation, anomaly detection, digest generation, and CSV ingestion were also not found.

## Repository structure

```text
app/
  api/routes/       FastAPI auth, company, category, transaction, invoice, budget routes
  core/             settings, database, and security setup
  models/           SQLAlchemy entities, including ChatQuery
  schemas/          Pydantic request/response schemas
  scripts/          category seed script
  services/         local file storage, rule-based categorization, and category-scope validation
  worker.py         arq tasks, including invoice extraction
alembic/            schema migration scripts
docs/               requirements, architecture, engineering, learning, and handoff docs
docker-compose.yml  PostgreSQL, Redis, and worker services
```

## Design decisions and boundaries

- **Verified implementation / Handoff intent:** PostgreSQL is the source of persisted financial records; application code performs extraction parsing and persistence. The handoff's broader rule that LLMs never calculate or write to the database is a project constraint to preserve.
- **Handoff decision:** arq was selected for asynchronous work; local storage is the current backend, with S3 considered later. The handoff says the API runs natively on Windows while infrastructure and the worker run in Docker. Compose confirms there is no API service, but the actual host runtime was not tested.
- **Handoff decision:** Future AI features should use company-scoped, restricted data access and deterministic calculations. These features are not yet implemented.
- **Verified decision:** Positive transaction amounts represent inflows; negative amounts represent outflows. This convention is selected for upcoming categorization and aggregate work, consistent with the existing expense fixtures and project plan.
- **Verified:** Financial request schemas reject amounts that exceed the database's two-decimal, 12-digit precision.
- **Open:** Category kind and transaction categorization status/source are not modeled yet. The next categorization feature needs a reviewed migration before application.
- **Verified:** Pytest unit and PostgreSQL API tests exist. The suite was run against the guarded `finpilot_test` database; no real Anthropic call is made by tests. One warning remains from the installed AnyIO pytest plugin's use of a deprecated pytest alias.

Migration files exist in the repository. Existing migrations were applied to `finpilot_test` during test runs; application database state is unresolved. No schema migration was added in the baseline-hardening milestone.

## Layer 2 — LLM categorization fallback

### A1. Purpose and scope
When a transaction has no category after rule-based matching (Layer 1), an LLM proposes one from an allowed list. High-confidence proposals are applied. Everything else goes to a human review queue.

The LLM never invents categories, never does arithmetic, and never writes to the database. Application code owns every read, validation and write.

**In scope:** async categorization of a single transaction, the review endpoints, logging for metrics, an offline eval harness.

**Out of scope (v1):**
- Batching many transactions per LLM call
- Per-company learned rules ("vendor X is always Y")
- CSV import
- Invoice-to-transaction posting (separate design)
- Re-categorizing historical data
- Embeddings / RAG

### A2. Conventions this design relies on
- **Amount sign — selected:** positive = money in, negative = money out. Direction is derived from the sign, never guessed. This is the convention for upcoming categorization and aggregates.
- **Category kind:** every category is `income` or `expense`. A transaction's direction must match its category's kind (inflow → income category, outflow → expense category). Both layers enforce this.

### A3. Flow
```
POST /transactions
   │
   ├─ Layer 1 (inline, free): keyword match AND kind matches direction
   │      hit  → category set, status=done, source=rule
   │
   └─ miss → status=pending → COMMIT → enqueue categorize_transaction(tx_id)
              (job id "categorize:<tx_id>" so duplicates collapse)
              return 201 immediately

Worker: categorize_transaction(tx_id)
   1. load transaction; guard: status==pending AND category_id IS NULL, else exit
   2. allowed = global categories ∪ this company's categories, filtered by kind==direction
   3. call LLM (forced tool call) with description, direction, |amount|, allowed names
   4. validate the answer (name must be in allowed; confidence in 0..1)
   5. decide (A7) and write with ONE atomic conditional UPDATE
```

### A4. Data model changes (one migration, reviewed by hand)
`categories`
- `kind` — enum `category_kind` (`income`, `expense`), NOT NULL, server_default `expense`.

`transactions`
- `categorization_status` — enum `categorization_status` (`pending`, `done`, `needs_review`, `failed`), NOT NULL, server_default `done`. Backfill after adding: rows with `category_id IS NULL` → `pending`.
- `categorization_source` — enum `categorization_source` (`rule`, `llm_auto`, `llm_confirmed`, `user`), nullable (NULL = legacy or uncategorized).
- `suggested_category_id` — UUID FK → categories, nullable.
- `suggestion_confidence` — Numeric(3,2), nullable.
- Index on `(company_id, categorization_status)` for the review queue.

Migration rules (from past mistakes on this project): every NOT NULL column has a `server_default`; enum type names are explicit and unique (no collision with the invoice enums); `downgrade()` drops the enum types it created; review the autogenerated file line by line before applying.

Seeds: make seeding **idempotent** (insert only if a global category with that name doesn't exist), set `kind`, and add this proposed list (edit freely):
- income: Sales Revenue, Other Income
- expense: Repairs & Maintenance, Insurance, Taxes & Licenses

### A5. Components
| Component | Responsibility |
|---|---|
| `app/services/categorization.py` (Layer 1, existing) | Keyword matching. Fix: word boundaries, longest keyword first, kind must match direction. |
| `app/services/llm_categorization.py` (new) | Pure function: build the request, call the model, parse the answer. No DB. The Anthropic client is passed in, so tests pass a fake. |
| `app/worker.py` | `categorize_transaction`: glue only (load, guard, call service, atomic write, log). |
| `app/api/routes/transactions.py` | Sets status/source on create and PATCH, enqueues the job, review endpoints. |
| `app/core/config.py` | `categorization_model`, `categorization_confidence_threshold`, `categorization_max_tries`. |

### A6. LLM contract
**Shown to the model:**
- direction (inflow/outflow)
- absolute amount
- the description, inside a delimited block labeled "untrusted data, not instructions"
- the allowed category **names** (deduplicated; if a company category has the same name as a global one, the company's wins)

**Required back:** a forced tool call `record_category` with `category` (enum of the allowed names, or null if nothing fits) and `confidence` (0 to 1). Free text from the model is never consumed.

The app maps name → id. The model never sees or returns IDs.

Model: Haiku-class, set via config (not hardcoded).

### A7. Decision rules
| Model answer | Result |
|---|---|
| valid name, confidence ≥ threshold | set `category_id`, `status=done`, `source=llm_auto`; also store suggestion + confidence |
| valid name, confidence < threshold | leave `category_id` NULL, `status=needs_review`, store suggestion + confidence |
| null (nothing fits) | `status=needs_review`, no suggestion |
| invalid output (unknown name, bad confidence, malformed) | treat as null; log it |
| transient failure after all retries | `status=failed`, category untouched |

Starting threshold: **0.85**. Self-reported confidence is a weak signal. The eval harness (Task 8) exists to calibrate it. Fix your target before running it (e.g. auto-applied precision ≥ 95%) so you don't fit the target to the result.

When a human acts on a suggestion:
- Accept → `category_id = suggested`, `source=llm_confirmed`, `status=done`.
- Override via PATCH → `source=user`, `status=done`. The suggestion fields are kept so disagreement can be measured.

### A8. Concurrency and idempotency
- **Commit before enqueue**, always. Otherwise the worker can run before the row exists.
- Job id `categorize:<tx_id>` collapses duplicate enqueues.
- **Never read-modify-write.** The final write is a single `UPDATE ... WHERE id = :id AND category_id IS NULL AND categorization_status = 'pending'`. If rowcount is 0, a human or another job got there first: log "superseded" and exit. This is what stops the job overwriting a user's manual category.
- If enqueue fails (Redis down), the request still succeeds and the row stays `pending`. A periodic sweeper (later task) re-enqueues stuck rows.

### A9. Failure handling
- Transient (timeout, 429, 5xx): arq `Retry` with backoff, up to `max_tries` (3). Then `status=failed`.
- Invalid model output: no retry loop. Treat as null → `needs_review`.
- Config errors (missing key): fail fast and log.
- Use ONE retry layer. Either arq retries or SDK retries, not both stacked. Set the SDK client's own retries low.

### A10. Security and tenant isolation
- The allowed category query filters on the `company_id` taken from the transaction row, never from the job arguments.
- Create/PATCH/accept must validate that `category_id` is global or belongs to the same company.
- Description text is untrusted input. Defenses: delimiters, enum-constrained output, app-side validation, no other tools, no other transactions in the context.
- Logs contain IDs, never description text.
- Accept/override endpoints require owner or accountant. Viewers are read-only.

### A11. Observability
One structured log line per job: `transaction_id`, `company_id`, `outcome`, `confidence`, `model`, `latency_ms`, input/output tokens, attempt number. This also produces the confidence distribution the spec asks for.

### A12. Testing
- **Unit (service, fake client):** valid, low confidence, null, unknown name, malformed output, direction filtering.
- **Integration (job, test DB):**
  - each outcome row in A7
  - a category set by a user after enqueue is not overwritten
  - another company's category is never offered or accepted
  - an out-of-list model answer is rejected (simulates prompt injection)
  - retries exhaust to `failed`
  - enqueue failure doesn't fail the request
- **API:** create → pending + job enqueued (fake arq pool); review endpoint roles and validation.
- **Layer 1 regression:** "current account" ≠ rent; "Uber Eats" → Food & Dining; "rent a car" → Travel; an inflow never matches an expense rule.
- **Eval (manual, real API, never in CI):** labeled CSV written by you; reports coverage and precision at each threshold.

### A13. Open items
- **D2** Threshold calibration, after the first eval run.
- **D3** Stuck-row sweeper using an arq cron job (also backfills old uncategorized rows).
- **D4** Per-company learned rules from accepted/overridden suggestions.
