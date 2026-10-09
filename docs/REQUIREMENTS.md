# FinPilot Requirements

## Source labels

- **Verified** means visible in the repository at inspection time.
- **Handoff** means stated in `FinPilot_Handoff.md`; it is historical project context, not independently verified product specification.
- **Open** means the requirement or current status still needs confirmation.

## Product direction

**Handoff:** FinPilot is intended as a multi-tenant financial management platform for small businesses. The longer-term flow is to ingest invoices, receipts, and bank statements; structure and categorize the data; provide dashboards; and add constrained AI-assisted answers, anomaly explanations, and digests. The companion `FinPilot_Project_Spec.md` named by the handoff is not present, so this direction needs confirmation against the canonical spec.

## Current functional baseline

**Verified:** The repository contains user registration and login, company membership and roles, and company-scoped routes for companies, transactions, invoices, budgets, and categories. It supports local invoice upload with asynchronous extraction work and rule-based transaction categorization. Authorization is not consistent across create routes; see the engineering log.

## Planned product scope

**Handoff:** Remaining planned work includes bank-statement CSV ingestion with per-row outcomes; an LLM fallback for unmatched transaction categorization with review for uncertain results; deterministic financial aggregates and dashboards; constrained financial Q&A; anomaly explanations; weekly digests; and a frontend and deployment path. These capabilities are not verified as implemented in the current repository.

## Constraints and design principles

- **Handoff decision:** Application code owns financial calculations, validation, and persistence. LLMs may transcribe or interpret inputs, but must not calculate financial facts or write directly to the database.
- **Handoff decision:** Keep AI outputs constrained and validated; for future categorization, select only from existing categories and route uncertain results for review.
- **Handoff decision:** RAG, embeddings, autonomous agents, forecasting, and recommendations are out of scope. Confirm these scope cuts with the missing project spec before treating them as canonical.
- **Verified design:** Company membership is used to gate company routes, and resource queries commonly include the company identifier. Preserve company-level isolation in future work.

## Outstanding requirements and questions

- Confirm product goals, priorities, and scope cuts against the original project spec.
- Define the intended write permissions for `viewer`; several current create routes allow any company member.
- Specify CSV formats, row validation, duplicate handling, and failure reporting before implementing statement ingestion.
- Define review behavior and confidence thresholds for future LLM categorization.
- Decide the initial dashboard metrics and their calculation rules.
- Confirm deployment/runtime targets and the supported Python version; the current project metadata and Docker image disagree.
- Define minimum automated test, logging, and operational-readiness expectations.
