# Engineering Log

This log records milestones and outstanding engineering work, not a file-by-file changelog. **Verified** items were checked in the repository or Git history. **Handoff** items are historical claims from `FinPilot_Handoff.md` that were not reproduced here. **Open** means status is unknown or needs a decision.

## Milestones

- **Verified — Git history:** The project progressed from a FastAPI health-check skeleton through database models/migrations, authentication, company membership, and company-scoped CRUD routes. Later commits added the Redis/arq worker foundation and Redis configuration. Commit `4677b2c` adds invoice upload/extraction support, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migrations.
- **Verified — current source:** Invoice upload and extraction, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migration scripts are present in the committed source.
- **Current task — baseline hardening (uncommitted):** Write roles are aligned, category references are tenant-checked, global categories are readable, category seeding is idempotent, rule matching uses whole words and longest matches, invoice output validation avoids partial persistence, and financial amounts are constrained to database precision. The worker image now uses Python 3.13. Added unit and API regression tests; latest run: 35 passed against `finpilot_test`.
- **Handoff — historical verification:** The handoff reports one successful Claude extraction using a sample PDF and one successful rule-categorization example. Those live checks were not repeated during repository inspection.

## Current state and outstanding issues

- **Resolved in current task:** Financial create routes require owner/accountant roles; category IDs and parent IDs cannot cross company boundaries; amounts are validated before reaching PostgreSQL; category seeds avoid duplicates on sequential reruns; malformed extraction output is rejected before field mutation.
- **Open:** Invoice processing has no distinct `needs_review` status for partial extraction; missing extracted fields are logged and left available for manual editing.
- **Verified absence in this repository:** CSV ingestion, dashboard aggregates, LLM categorization fallback, financial Q&A, anomaly detection, and weekly digest generation remain unimplemented. Frontend and deployment are excluded from this task.
- **Open:** Application database migration state is unknown. Test runs use the guarded `finpilot_test` database. No new migration has been introduced in this task yet.
- **Test warning:** The installed AnyIO pytest plugin uses a deprecated pytest alias; this is dependency-side and does not fail the suite.

## Recommended next engineering task

Next implement the documented Layer 2 categorization flow, including a manually reviewed schema migration, constrained LLM contract, atomic conditional update, review endpoints, and safety tests. The human authorized creating/reviewing migrations and applying them only to the guarded `*_test` database. Preserve the chosen amount-sign convention and do not run real LLM calls in CI.
