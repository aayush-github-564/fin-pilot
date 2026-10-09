# Engineering Log

This log records milestones and outstanding engineering work, not a file-by-file changelog. **Verified** items were checked in the repository or Git history. **Handoff** items are historical claims from `FinPilot_Handoff.md` that were not reproduced here. **Open** means status is unknown or needs a decision.

## Milestones

- **Verified — Git history:** The project progressed from a FastAPI health-check skeleton through database models/migrations, authentication, company membership, and company-scoped CRUD routes. Later commits added the Redis/arq worker foundation and Redis configuration. Commit `4677b2c` adds invoice upload/extraction support, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migrations.
- **Verified — current source:** Invoice upload and extraction, local file storage, rule-based categorization, category seeding, and invoice processing-status/nullable-field migration scripts are present in the committed source.
- **Handoff — historical verification:** The handoff reports one successful Claude extraction using a sample PDF and one successful rule-categorization example. Those live checks were not repeated during repository inspection.

## Current state and outstanding issues

- **Verified:** Manual create routes for invoices, transactions, budgets, and categories require company membership but do not consistently require an owner/accountant role. The invoice upload route does require that role. Align the create-route policy with the intended viewer permissions.
- **Verified:** Invoice extraction parses amount and ISO-formatted date values, but missing fields can still result in `complete`. An exception after assigning some fields can persist partial extracted values while marking the invoice `failed`.
- **Verified:** `pyproject.toml` requires Python `>=3.13`, but the worker Dockerfile uses Python 3.12. Resolve this mismatch before relying on worker-container runs.
- **Verified:** The category seed script inserts defaults without checking for existing rows, so rerunning it can create duplicates.
- **Verified absence in this repository:** No test suite, CI configuration, CSV ingestion, dashboard, LLM categorization fallback, AI query/anomaly/digest feature, or frontend was found.
- **Open:** Migration files are present, but database application state is unknown. Live service behavior, historical duplicate cleanup, and whether any API key was committed were not established by this inspection.
- **Git state at inspection:** The branch is `main`, up to date with `origin/main`. The implementation is committed; the `docs/` directory is untracked and contains the handoff and documentation files.

## Recommended next engineering task

First align write authorization across company resource creation routes with the intended owner/accountant/viewer policy. Then resolve the Python-version mismatch before validating the worker runtime. The handoff's next planned feature is the LLM categorization fallback; it remains unimplemented and should follow these readiness issues. Review migrations manually before any future application, as directed by the handoff.
