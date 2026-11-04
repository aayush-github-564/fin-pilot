# Engineering Log

This log records milestones and outstanding engineering work, not a file-by-file changelog. **Verified** items were checked in the repository or Git history. **Handoff** items are historical claims from `FinPilot_Handoff.md` that were not reproduced here. **Open** means status is unknown or needs a decision.

## Milestones

- **Verified — Git history:** The project progressed from a FastAPI health-check skeleton through database models/migrations, authentication, company membership, and company-scoped CRUD routes. Later commits added the Redis/arq worker foundation and Redis configuration. Commit `4677b2c` adds invoice upload/extraction support, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migrations.
- **Verified — current source:** Invoice upload and extraction, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migration scripts are present in the committed source.
- **Committed — baseline hardening:** Commit `9b5026a` aligns write roles, validates category scope, makes seeding idempotent, fixes rule matching and invoice parsing, constrains financial amount precision, and aligns the worker image to Python 3.13.
- **Committed — Layer 2 categorization:** Commit `2e7f70e` adds category kinds and transaction categorization state, the constrained Anthropic tool contract, an arq worker with atomic writes/retries, review/accept routes, stale-row sweeping, JSON log formatting with request IDs propagated to categorization and invoice jobs, and a manual labeled-CSV evaluation harness.
- **Committed — CSV ingestion:** Commit `a5ead59` adds bounded bank-statement CSV parsing with per-row outcomes, stored-file row references, company-scoped idempotency, concurrent duplicate protection, and reuse of transaction categorization.
- **Current task — financial metrics (uncommitted):** Added SQL-aggregated cash-flow and budget-versus-actual APIs, explicit period/runway semantics, and indexes for company/date and company/period queries. Latest full run: 104 passed against `finpilot_test`; index migration upgrade/downgrade, metadata check, and compile checks passed.
- **Handoff — historical verification:** The handoff reports one successful Claude extraction using a sample PDF and one successful rule-categorization example. Those live checks were not repeated during repository inspection.

## Current state and outstanding issues

- **Resolved in prior milestone:** Financial create routes require owner/accountant roles; category IDs and parent IDs cannot cross company boundaries; amounts are validated before reaching PostgreSQL; category seeds avoid duplicates on sequential reruns; malformed extraction output is rejected before field mutation.
- **Verified:** Categorization uses positive=inflow and negative=outflow; zero is routed to review. The model only sees allowed names and receives a forced tool call. The worker derives tenant scope from the transaction row and protects manual writes with a conditional update.
- **Verified:** During migration, legacy signed transactions with a category of the wrong kind are marked `needs_review` while retaining their existing category assignment.
- **Open:** Confidence threshold calibration is pending a real labeled evaluation run. Per-company learned rules remain out of scope for this layer.
- **Open:** Invoice processing has no distinct `needs_review` status for partial extraction; missing extracted fields are logged and left available for manual editing.
- **Verified absence in this repository:** Financial Q&A, anomaly detection, and weekly digest generation remain unimplemented. Frontend and deployment are excluded from this task.
- **Open:** Application database migration state is unknown. The categorization, CSV import, and metrics index migrations were applied and rolled back/reapplied only on the guarded `finpilot_test` database.
- **Test warning:** The installed AnyIO pytest plugin uses a deprecated pytest alias; this is dependency-side and does not fail the suite.

## Recommended next engineering task

Next build constrained financial Q&A with company-scope and read-only safety tests, then implement anomaly explanations and weekly digests. Keep real LLM evaluation manual and leave frontend/deployment phases deferred.
