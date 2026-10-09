# FinPilot — Engineering Handoff (for Claude Code / Codex)

**Last updated:** 2026-10-09
**Owner:** Aayush (solo build, learning-while-building)
**Companion doc:** `FinPilot_Project_Spec.md` (the original spec — this file is the *current-state* layer on top of it)

> **How to use this file:** Put it in the repo root (or `docs/`) next to the spec. Read Sections 1, 2, 9 and 10 first. Section 8 lists things I could NOT verify and that you must check against the real repo before trusting this doc.

---

## 1. What this project is

FinPilot is a multi-tenant B2B AI-native financial management platform for small businesses: upload invoices/receipts/bank CSVs → structure them into a relational schema → categorize → dashboards → constrained AI Q&A, anomaly explanations, and weekly digests.

**Non-negotiable design principle (spec Section 7):** the LLM *transcribes and interprets*; it never does arithmetic, never touches the DB, and is never the source of truth for numbers. Application code owns orchestration, validation, and persistence. Every LLM use must follow this.

**Explicitly NOT in scope:** RAG, embeddings, autonomous agents, Tier 3 (forecasting/recommendations — cut entirely).

---

## 2. Phase status at a glance

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema design | ✅ Done |
| 2 | Auth (JWT, signup/login) | ✅ Done |
| 3 | API/CRUD + RBAC | ✅ Done |
| 4 | Ingestion pipeline | 🟡 Extraction ✅, rule-based categorization (Layer 1) ✅, **LLM categorization fallback (Layer 2) ❌ not built** |
| 5 | AI layer (text-to-SQL, anomalies, digest) | ❌ Not started |
| 6 | Frontend + AWS deployment | ❌ Not started |
| — | Tests, structured logging, README/demo | ❌ Largely not started (see Section 7) |

> Note: the saved project notes call Phase 4 "complete", but the last session's handoff listed Layer 2 as the remaining Phase 4 item. Treat Layer 2 as **still open** until the repo proves otherwise.

---

## 3. Architecture and stack

- **API:** FastAPI (async), Pydantic v2, versioned under `/api/v1/...`
- **DB:** PostgreSQL 16, SQLAlchemy (async, asyncpg), Alembic migrations
- **Jobs:** `arq` + Redis (chosen over Celery for async-native simplicity)
- **LLM:** Anthropic SDK; `claude-haiku-4-5-20251001` for extraction (cheapest/fastest tier, simple transcription task)
- **Tooling:** `uv` (all installs via `uv add`, never bare `pip`), Docker Desktop, Git + `gh` CLI (SSH remote configured), VS Code
- **Auth:** hand-rolled JWT (bcrypt pinned `<4.1` for passlib compatibility)
- **Storage:** local disk behind a storage abstraction (S3 later)
- **Mongo:** not used. Spec listed it as optional; recommend formally dropping it.

### Runtime topology (important — this has bitten us)

| Component | Where it runs |
|---|---|
| FastAPI app | **Natively on the Windows host** (`uv run fastapi dev`), not in Docker |
| Postgres, Redis, arq worker | Docker (`docker-compose.yml`) |

Consequences:
- `.env` uses `REDIS_URL=redis://localhost:6379/0` and a localhost `DATABASE_URL`; the worker service **overrides** both in `docker-compose.yml` to `redis://redis:6379/0` and `...@postgres:5432/...`.
- The API and worker don't share a filesystem, so the worker service has a bind mount: `./uploads:/app/uploads`. Without it `extract_invoice` fails with `FileNotFoundError`. (Fixed and verified.)
- `DOCKER_BUILDKIT=0` is set as a persistent Windows user env var to avoid a BuildKit file-request bug.
- Worker code changes require a rebuild: `docker-compose build worker && docker-compose up -d worker`. Compose-only changes need just `docker-compose up -d worker`.

### Background job flow (the established mental model)

`API` (receptionist) → `Redis` (notice board) → `arq worker` (assistant) → `Postgres` (filing cabinet). Reuse this analogy when explaining to Aayush.

---

## 4. What is implemented

### Repo layout (as described in session notes — verify against repo)
```
app/
  main.py                 # FastAPI app; lifespan opens a shared arq/Redis pool on app.state.redis
  worker.py               # arq WorkerSettings; sample_task, extract_invoice
  core/config.py          # Settings (incl. upload_dir, anthropic_api_key)
  api/deps.py             # get_current_company_member, require_role(), get_arq_redis
  api/routes/             # auth, companies, transactions, invoices, budgets, categories
  models/                 # SQLAlchemy models (invoice.py has ProcessingStatus enum)
  schemas/                # Pydantic v2 schemas
  services/
    storage.py            # save_file(upload, company_id) -> ref; get_file_path(ref) -> Path
    categorization.py     # CATEGORY_RULES, match_category(), resolve_category_id()
  scripts/
    seed_categories.py    # one-time seed of global categories — DO NOT RE-RUN
alembic/                  # migrations
docker-compose.yml        # postgres, redis, worker (+ pgdata volume)
```

### Auth, tenancy, RBAC (Phases 2–3)
- Signup/login with JWT.
- Multi-company: users belong to companies via `CompanyMember` with roles `owner / accountant / viewer`.
- **Tenancy wall:** `get_current_company_member` in `deps.py` gates every company-scoped route.
- `require_role("owner", "accountant")` guards writes.
- `invite-member` endpoint exists.
- Full CRUD (create, list, GET-by-id, PATCH, DELETE) on all five resources: companies, transactions, invoices, budgets, categories.
- PATCH convention: `exclude_unset=True`.

### Storage module
`save_file()` writes to `uploads/{company_id}/{uuid}{ext}` and returns that relative path as `file_reference` (shaped like a future S3 key — swapping backends should only touch `storage.py`). `get_file_path()` resolves it back for the worker. `UPLOAD_DIR=uploads` in `.env`; `uploads/` is gitignored.

### Invoice model — two deliberately separate status fields
- `Invoice.status`: **billing** status — `pending / paid / overdue / cancelled`
- `Invoice.processing_status`: **pipeline** status — `pending / processing / complete / failed`
- `vendor`, `amount`, `date` are **nullable** because the row is created at upload, before extraction runs.
- `InvoiceRead` exposes `processing_status` and `file_reference`; `vendor/amount/date` are Optional.

### Upload + extraction pipeline (live-verified)
1. `POST /api/v1/companies/{company_id}/invoices/upload` (`require_role`) saves the file, creates an Invoice row with only `file_reference` set, enqueues `extract_invoice` via arq, returns **201** immediately.
2. `extract_invoice(ctx, invoice_id)` in `worker.py`: set `processing` → read file via `get_file_path()` → base64 → send to Claude Haiku as a `document`/`image` block with a strict "JSON only: vendor, amount, date" prompt → `_clean_json_response()` strips stray markdown fences → update row, set `complete`.
3. Every failure path (unsupported type, malformed JSON, missing fields, API error) logs the exception and sets `failed`. No half-written rows.
4. **Verified** with the standard "Sliced Invoices" sample PDF: result `complete`, vendor `DEMO - Sliced Invoices`, amount `93.50`, date `2016-01-25` — correct.
5. Prompt only asks the model to transcribe printed values, never compute.

Not yet tested: messy real-world invoices, images (PNG/JPG), multi-page PDFs, non-USD/odd date formats, a failure-path run against the real API.

### Categorization — Layer 1 (rule-based)
- `CATEGORY_RULES: dict[str, str]` keyword → category name, built for realistic **B2B** descriptors (AWS, GitHub, Gusto, WeWork, Stripe fees, LegalZoom…), deliberately not consumer examples.
- `match_category(description) -> str | None` is pure substring matching (unit-testable, no DB).
- `resolve_category_id(description, db)` looks up the global-default `Category` (`company_id=None`) by name.
- `TransactionCreate.category_id` is Optional; `create_transaction` auto-resolves when omitted.
- Verified: `"GUSTO PAYROLL - SEPT"` → "Payroll & Contractors".
- Unmatched descriptions currently stay `category_id = None` (honest, not wrong, but unresolved).

### Migrations applied (all manually reviewed)
- `128ff12ef5f1` — `processing_status` + enum (hand-fixed: `server_default='pending'`, explicit enum `create()/drop()`)
- `1a13e12b7aa6` — Invoice `vendor/amount/date` nullable (clean)
- Earlier migrations for the base schema (see `alembic/versions/`).

---

## 5. Known issues / housekeeping

1. **`create_invoice`** (plain `POST /invoices`, manual entry) uses `get_current_company_member` instead of `require_role("owner","accountant")`. A viewer can likely create invoices. Flagged, deliberately deferred. **Fix this — it's a real authorization gap, small change.**
2. **Delete `test_categorization.py`** at repo root if it still exists (scratch file).
3. **Never re-run `seed_categories.py`** — it previously created duplicate global categories (since cleaned by one-off scripts that were not saved). Consider making it idempotent (upsert by name) or adding a unique constraint on `(company_id, name)`.
4. Failed jobs are not retried automatically; a failed invoice stays `failed` until re-uploaded. No retry/re-extract endpoint exists yet (cheap to add: `POST .../invoices/{id}/reprocess`).
5. Extraction output is written without cross-checks (e.g. no sanity check that `amount` parses as a decimal or `date` as ISO). Add validation before persisting.

---

## 6. Remaining work (ordered, with acceptance criteria)

### 6.1 Finish Phase 4 — LLM categorization fallback (Layer 2) ← **next task**
- For transactions where `match_category()` returns `None`, send the description (and amount/direction if useful) to Claude; request strict JSON `{category, confidence}` constrained to the **existing category names** (pass the list in the prompt; reject anything not in it).
- Run it as an **arq job** off the request path, not inline in `create_transaction`.
- Confidence ≥ threshold (start ~0.8, make it a setting) → auto-assign. Below → leave unassigned and flag for review.
- Needs a schema addition for review state, e.g. `categorization_source` (`rule/llm/manual`), `categorization_confidence`, `needs_review` bool. Migration must be hand-reviewed.
- Add a review endpoint (list `needs_review`, confirm/override).
- Respect the principle: the model picks from a closed list; code validates and persists.
- **Done when:** unmatched descriptions get categorized or flagged, failures are logged and non-fatal, and tests with a mocked LLM cover high-confidence, low-confidence, invalid-category, and API-error paths.

### 6.2 Bank statement CSV ingestion (spec Tier 1 — confirm status)
The spec requires CSV statement upload with per-row parse/fail logging. I found no evidence it's built. Verify; if missing, build it before Phase 5 (the AI layer needs real transaction data): background parse, rows parsed/failed with reasons, run Layer 1 → Layer 2 per row.

### 6.3 Dashboard backend (spec Tier 1)
Deterministic aggregates: inflow/outflow over time, burn rate, runway, budget vs actual. Cache in Redis, invalidate on writes. All numbers computed in SQL/Python, never by an LLM.

### 6.4 Phase 5 — AI layer (highest risk, budget real time)
1. **Text-to-SQL Q&A agent** (spec Sections 6–7, the most important safety decision in the project):
   - LLM must NOT emit free-form SQL against base tables. Use a **restricted, per-company view/query template** with whitelisted tables/columns.
   - Validate before execution: SELECT-only, single statement, `company_id` scoping enforced by the *backend* (not by trusting the prompt), no cross-table leakage, row/time limits, read-only DB role.
   - Log every query to a `ChatQuery`/audit table: `company_id, user_id, natural_language_query, generated_sql, executed, created_at`.
   - If not confident, answer "I can't answer that" instead of guessing.
   - Rate-limit LLM calls via Redis.
2. **Anomaly detection:** z-score vs. vendor/category history computes the flag; the LLM only explains the *already-flagged* data.
3. **Weekly digest:** scheduled arq cron job aggregates numbers deterministically; the LLM writes prose from those computed numbers; email delivery.
4. Optional (from earlier planning): a small eval set for the text-to-SQL agent to strengthen the AI-native story.

### 6.5 Tests (spec Section 10 — currently thin)
- Unit: `match_category`, budget/cash-flow math, JSON cleaning/validation.
- Integration: httpx `TestClient`, **LLM mocked** (no real API calls in CI).
- **Safety tests:** attempts to cross company boundaries or write via the SQL agent must be rejected. Multi-tenancy tests for every route (cross-company reads/writes → 403/404).
- Extraction: malformed JSON, missing fields, unsupported file types → `failed` + logged error, no corrupt data.

### 6.6 Logging and error handling (spec Section 11)
JSON structured logging, request/correlation IDs threaded from API into arq jobs, centralized FastAPI exception handlers with a consistent error shape, ingestion metrics (rows parsed/failed, confidence distribution).

### 6.7 Phase 6 — Frontend + deployment
- React: dashboard, upload UI with `processing_status` polling, chat panel, review queue.
- Dockerize the API and frontend too (currently API runs natively on Windows).
- AWS: ECS/Fargate, RDS, S3 (swap `storage.py`), CloudWatch. Time-box with a fallback (prior decision). Spike early; env/IAM/networking mismatches are the usual time sink.

---

## 7. Test and run status

I cannot see the repo from here, so this is what the session history supports:

| Item | Status |
|---|---|
| Upload → extraction, real Claude call | ✅ Manually verified (one clean PDF) |
| Rule-based categorization | ✅ Manually verified (one case) |
| Automated test suite | ❓ Not evidenced — assume absent/minimal |
| CI | ❓ None evidenced |

### Run it locally
```bash
docker-compose up -d postgres redis worker
uv sync
uv run alembic upgrade head
uv run fastapi dev            # API on http://localhost:8000 ; docs at /docs
docker-compose logs -f worker # watch jobs
```
After changing worker code: `docker-compose build worker && docker-compose up -d worker`.

Required `.env` keys: `DATABASE_URL`, `REDIS_URL`, `UPLOAD_DIR=uploads`, `ANTHROPIC_API_KEY`, JWT secret settings (see `app/core/config.py`).

---

## 8. Git / commit status — UNVERIFIED, check first

The last session's notes said **no commits had been made** for that session's work and reminded Aayush to commit in logical chunks. I don't know whether that happened. Before doing anything else, run:

```bash
git status
git log --oneline -20
git branch -a
```

If the work is uncommitted, commit it in these logical units (Conventional Commits, feature branch off `main`):
1. `feat(storage): add local file storage service`
2. `feat(invoices): add processing_status field and migration`
3. `feat(invoices): make vendor/amount/date nullable`
4. `feat(invoices): add upload endpoint with arq enqueue`
5. `feat(worker): extract invoice fields via Claude`
6. `feat(categorization): rule-based categorization and seed script`
7. `fix(docker): bind-mount uploads into worker container`

Also confirm `.env` and `uploads/` are gitignored and that no API key was ever committed.

---

## 9. Conventions the agent must follow

**Collaboration style (Aayush's stated preferences):**
- Loop: big picture (what/why/how it connects) → complete working code → Aayush runs it and pastes back **verbatim** terminal output → review → proceed. Read output closely; don't assume success.
- Skip line-by-line narration on mechanical code. For genuinely new architecture/AI concepts, explain the *why* first, slowly, with analogies (reuse the receptionist/notice-board/assistant/filing-cabinet framing).
- His clarifying questions are signal, not detours — answer them properly.
- Be direct and honest; flag overclaiming and design problems proactively rather than reassuring.

**Engineering rules:**
- **Review every Alembic migration by hand before applying** — autogenerate has repeatedly missed `server_default`, orphaned Postgres enum cleanup, and enum-name collisions. No exceptions.
- All installs via `uv add`. Windows gotchas: OneDrive file locking can corrupt `uv` installs; keep bcrypt `<4.1`.
- One logical unit per commit, Conventional Commits, feature branches.
- Every company-scoped query must enforce `company_id` at the query layer, not just the route.
- LLM calls: closed-set outputs, strict JSON, defensive parsing, failure → logged + safe state. Never let the model compute or write.
- Keep real LLM calls out of tests. Watch API spend (prepaid billing, auto-reload off; the account hard-stops at $0).

---

## 10. First-session checklist for the incoming agent

1. Run the Section 8 git commands; report state before changing anything.
2. Boot the stack (Section 7) and confirm login, upload, and extraction still work end to end.
3. Delete `test_categorization.py` if present; confirm `.gitignore` covers `.env` and `uploads/`.
4. Fix the `create_invoice` `require_role` gap (small, high value).
5. Confirm whether CSV statement ingestion exists (6.2).
6. Start Layer 2 categorization (6.1), then move to Phase 5 with the SQL-agent safety design written down *before* coding.

---

## 11. Decisions log

| Decision | Outcome |
|---|---|
| OCR approach | Vision-capable LLM (Claude) instead of OCR library |
| Job framework | `arq` |
| Auth | Hand-rolled JWT |
| Mongo | Not used; drop |
| Tier 3 (forecasting, recommendations) | Cut entirely |
| AWS | Time-boxed with fallback |
| Extraction model | `claude-haiku-4-5-20251001` |
| Invoice status fields | Separate `status` (billing) and `processing_status` (pipeline) |
