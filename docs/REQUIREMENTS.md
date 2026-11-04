# FinPilot Requirements

## Source labels

- **Verified** means visible in the repository at inspection time.
- **Handoff** means stated in `FinPilot_Handoff.md`; it is historical project context, not independently verified product specification.
- **Open** means the requirement or current status still needs confirmation.

## Product direction

**Project spec:** FinPilot is a multi-tenant financial operations app for small businesses. The remaining backend scope includes CSV ingestion, LLM-assisted categorization with review, deterministic cash-flow metrics, constrained financial Q&A, anomaly explanations, and weekly digests. Frontend and deployment work are excluded from the current completion task.

## Current functional baseline

**Verified:** The repository contains user registration and login, company membership and roles, and company-scoped routes for companies, transactions, invoices, budgets, and categories. It supports local invoice upload with asynchronous extraction work and whole-word, longest-match rule categorization. Create and update paths validate company-owned category references, and financial writes require owner or accountant roles. Unit and PostgreSQL API tests cover these baseline behaviors.

## Planned product scope

**Project spec:** Remaining backend work includes bank-statement CSV ingestion with per-row outcomes; an LLM fallback for unmatched transaction categorization with review for uncertain results; deterministic financial aggregates; constrained financial Q&A; anomaly explanations; and weekly digests. Frontend and deployment are explicitly deferred. Stretch forecasting and recommendations follow Tier 1 and Tier 2.

## Constraints and design principles

- **Handoff decision:** Application code owns financial calculations, validation, and persistence. LLMs may transcribe or interpret inputs, but must not calculate financial facts or write directly to the database.
- **Handoff decision:** Keep AI outputs constrained and validated; for future categorization, select only from existing categories and route uncertain results for review.
- **Project spec:** Financial arithmetic remains deterministic application code; LLM responses must be constrained and validated. Tier 3 forecasting and recommendations are stretch scope after the required features.
- **Verified design:** Company membership is used to gate company routes, and resource queries commonly include the company identifier. Preserve company-level isolation in future work.

## Outstanding requirements and questions

- **Resolved:** `viewer` is read-only; owners and accountants may create or update financial resources.
- **Resolved by engineering choice:** Amounts use positive=inflow and negative=outflow; zero is neutral. Financial API inputs use the database's two decimal places and maximum precision.
- **Open engineering choices:** CSV header mapping, duplicate policy, and partial-row reporting; initial metrics and time boundaries; categorization confidence calibration; and Q&A query constraints. These will be defined in their feature milestones and recorded with tests.
- **Resolved:** Python 3.13 is the supported runtime, matching project metadata and the worker image. The container image build remains unverified.
