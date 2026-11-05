# FinPilot Frontend: Architecture and Ownership Brief

Basis: initially prepared against repository commit `6748cc8`. Reconciled against source at `416ef63` on 2026-11-05. **Source code is the authority**; where this file and the code disagree, trust the code, fix the file, and mention it in the final report.

---

## 1. Mandate

You own the entire frontend build, including the small backend changes it needs (Section 3). Plan it, sequence it, make the design decisions inside the boundaries below, build it, test it, and document it. You are not given task-by-task instructions and you should not wait for approval between steps. Decide, record the decision, keep going.

Three principles override everything else:

1. **The UI never computes financial facts.** It formats and charts what the API returns. Amounts stay strings; numbers appear only at the chart boundary.
2. **AI surfaces show their constraints.** Source badges (`llm` vs `deterministic`), the unsupported-question path, rate limits, and truncation notices are product features.
3. **Tenant isolation and roles are not relaxed for convenience.** Role gating in the UI is UX only; the backend remains the authority.

## 2. What the backend exposes (verified from source)

All routes are under `/api/v1`. Company routes are gated by membership; roles are `owner | accountant | viewer`. Positive amount = inflow, negative = outflow.

| Area | Endpoints | Things to respect |
|---|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | Login is **form-encoded** (`username` = email). Register returns the user, not a token. Tokens last 30 min; there is no refresh endpoint. |
| Companies | `POST/GET /companies`, `GET /companies/{id}`, `GET /companies/{id}/me`, `PATCH/DELETE /companies/{id}`, `POST /companies/{id}/invite` | `GET /companies` returns each company's `role` and `currency_code`; `/me` returns the current member's company context. No members-list endpoint. New companies require a current ISO 4217 `currency_code`; legacy companies may have null until an owner sets it once. |
| Categories | CRUD under `/categories` | List includes globals (`company_id: null`). `kind` is `income` or `expense`. |
| Transactions | `POST`, `GET` list, `GET /review` (`skip`/`limit` ≤ 200), `POST /import-csv`, `POST /{id}/accept-suggestion`, `GET/PATCH/DELETE /{id}` | Main list uses `offset`/`limit` and returns `items`, `total`, and `has_more`; it supports date, category, status, source, direction, and search filters. Review uses `skip`/`limit`. `categorization_status`: `pending, done, needs_review, failed`. |
| Invoices | `POST`, paginated `GET`, `POST /upload`, `GET /{id}/download`, `POST /{id}/confirm`, `GET/PATCH/DELETE /{id}` | List is newest-first with `skip`/`limit` (max 200). Status is `pending, paid, overdue, cancelled`; `processing_status`: `pending, processing, complete, failed`. Extracted fields are nullable until confirmed. Download is company-scoped. |
| Budgets | CRUD under `/budgets` | `period` is `YYYY-MM`; `limit_amount > 0`. |
| Metrics | `GET /metrics/cash-flow`, `GET /metrics/budget-vs-actual?period=` | Cash flow: `start_date`, `end_date` (≤ 366 days), `granularity=day\|month`, optional `cash_balance` for runway. |
| Chat | `POST /chat/query` `{question}` | Constrained planner: `cash_flow_summary`, `expenses_by_category`, `largest_expenses`, `budget_vs_actual`, or `unsupported`. 10 req/min/user/company (429 + `Retry-After`); 503 if Redis is down. No history endpoint. |
| Insights | `GET /insights/anomalies?days&baseline_days` | On demand; may call the LLM; truncation flags in the response. |
| Digests | `GET /digests/weekly?period_start=<Monday>` | Latest if omitted; 404 if none; 422 if not a Monday. No list endpoint. `facts` is an untyped dict. |

## 3. Backend changes you are authorized to make

These are decided. Implement them first or as early as needed; frontend work can proceed in parallel against the changed contract.

1. **Role endpoint.** Implemented: `GET /companies/{company_id}/me` returns the current member and existing `CompanyMembershipRead` shape. The company list already includes role and currency.
2. **Transaction list.** Already implemented in source as `offset`/`limit` (default 50, max 200), with the requested date/category/status filters plus source/direction/search, stable ordering, and `total`/`has_more` in the response body. Preserve this established contract; do not add the stale brief's `skip` parameter or `X-Total-Count` header.
3. **Invoice list.** Implemented as newest-first `skip`/`limit` pagination.
4. **Write-authorization audit.** Every company, transaction, invoice, budget, and category PATCH/DELETE requires owner/accountant, except company PATCH/DELETE which require owner. Global category update/delete queries are company-scoped and return not found. Invoice `status` is now constrained to its enum.
5. **Company currency.** The source field is `currency_code` (nullable for legacy companies), not `currency`. New and legacy assignments now require an active ISO 4217 code; the UI prefills INR as a form default, owners can set a legacy value once, and display performs no conversion.
6. **Invoice direction and confirmation.** Already implemented: uploads record `direction` (`purchase` or `sale`); confirmation is owner/accountant-only, requires completed extraction and required values, and is idempotent. **Invoices never feed cash-flow metrics**: they are not transactions, and posting them would double-count bank-statement rows. The UI must say so plainly. A duplicate-document warning (by file hash) remains a nice-to-have and is not blocking.
7. **OpenAPI export.** Implemented by `python -m app.scripts.export_openapi`; it writes `frontend/openapi.json` for type generation.

**Migration rules (from `AGENTS.md`, unchanged):** write migrations by hand-reviewed standards (explicit `server_default` on NOT NULL, explicit unique enum names, `downgrade()` drops what it created). Apply, downgrade, and reapply **only on the guarded `finpilot_test` database**. Never touch the application database. List every migration in your final report so it can be reviewed before it is applied anywhere real.

**Decided against:** refresh tokens and cookie sessions. Tokens stay at 30 minutes; the frontend handles 401 by returning to login and then back to the original page. Do not add refresh or cookie auth.

## 4. Architecture decisions (fixed)

| Concern | Choice |
|---|---|
| App | Vite + React + TypeScript (strict) single-page app in `frontend/` beside `app/` |
| Routing | React Router; company is in the URL: `/c/:companyId/...` |
| Server state | TanStack Query. **Every query key begins with `["company", companyId]`.** |
| API types | Generated from `frontend/openapi.json` with `openapi-typescript` and `openapi-fetch`. No hand-written API types except zod schemas for untyped `facts` payloads |
| `facts` payloads | zod schemas written from **real captured responses**, with fallback to the plain-text `answer`/`summary` when parsing fails |
| Forms / validation | react-hook-form + zod |
| UI | Tailwind + shadcn/ui; tables with TanStack Table; charts with Recharts |
| Dates | `date-fns`; treat `YYYY-MM-DD` as a calendar string, never `new Date("YYYY-MM-DD")` (UTC shift). Digest weeks are UTC Monday–Sunday |
| Money | `lib/money.ts`: format only, no arithmetic. Confirm Decimal JSON representation (string vs number) against a live response first and make the parser tolerate both |
| Auth | Token in memory mirrored to `sessionStorage`. Any 401 clears it and routes to `/login?next=` |
| Origin | Same-origin: Vite proxy to FastAPI in dev; nginx serving the build and proxying `/api` in prod. **No CORS middleware** |
| Errors | One normalizer: `detail` is a string for most errors but an array of `{loc, msg}` for 422. Handle 401, 403, 409, 413, 422, 429 (`Retry-After`), 503 distinctly |
| Safety | All server/AI text rendered as plain text; never `dangerouslySetInnerHTML` |
| Polling | Only while something is pending/processing; stop on settle, hidden tab, or unmount |
| Tests | Vitest + Testing Library + MSW for components/hooks; a few Playwright smoke flows against the real backend. **No real Anthropic calls in any test** |

You may add dependencies beyond this list when clearly justified; record each addition and its reason in `docs/ENGINEERING_LOG.md`.

Suggested structure (adjust if you have a better one):

```text
frontend/src/{app, api, features/<auth|companies|transactions|categories|review|imports|invoices|metrics|budgets|chat|insights|digests>, components/ui, lib, test}
```

## 5. Product scope

Priority is by value, not by schedule. If you must cut, cut from the bottom, and record what you cut and why.

**Must have**
- Auth, company list/create/switch, role-aware shell (`useRole`), currency banner.
- **Dashboard:** KPIs (inflow, outflow, net, average monthly burn, runway), cash-flow chart (range presets and custom ≤ 366 days, month/day), optional cash-balance input that drives runway (show `runway_status` reasoning when unavailable; negative burn reads as "generating cash"), budget-vs-actual for a chosen month, review-queue count, recent transactions.
- **Transactions:** server-paginated table with filters, create/edit/delete (Inflow/Outflow toggle with positive entry, signed on submit), status badges, inline category change restricted to categories whose `kind` matches direction.
- **Review queue:** shows suggestion and confidence; Accept or override; on 409, refetch and inform, do not retry.
- **CSV import:** client-side 5 MiB check, assumptions stated up front (accounting currency, ambiguous slash dates read day-first), result summary plus filterable per-row report with error messages, then refresh and poll pending rows.
- **Chat:** see 5.1.
- **Anomalies:** see 5.2.
- **Digests:** see 5.3.

**Should have**
- Invoices: upload with direction, bounded polling to `complete`/`failed`, null-field flags, edit and confirm, with copy stating invoices do not affect cash flow.
- Budgets CRUD (expense categories only, month picker), categories management (globals read-only, 409 shown inline).

**Could have**
- Team/invite page, dark mode, Playwright beyond three smoke flows, duplicate-invoice warning.

### 5.1 Chat
- Suggestion chips for the four supported question types; `unsupported` renders as a friendly redirect, not an error.
- Messages are session-local (no history endpoint exists; say so, do not fake persistence).
- Show the deterministic `answer` first, then a card by `query_type`; parse `facts` with zod and degrade to text.
- Provenance line: period and date range from the response, plus a note that figures are computed from the company's data and the AI only selected the query.
- 429: disable input with a `Retry-After` countdown. 503: "temporarily unavailable". Keep the typed question on failure. Show "top N" when `has_more`. Viewers may use chat.

### 5.2 Anomalies
- Runs only on explicit user action, never on page load (LLM-backed, rate-limited); cache briefly.
- Window and baseline controls within API bounds. Each anomaly shows description, category, amount, baseline average, ratio, z-score if present, basis (vendor/category), explanation, and an `llm`/`deterministic` badge, linked to the transaction.
- Show `scan_truncated` and `anomalies_truncated`. Clear empty state with the windows used.

### 5.3 Digests
- Latest by default; prev/next by Monday ± 7 days using calendar-string arithmetic. 404 is an empty state, not an error.
- Show summary with source badge, current vs previous week with trend signals, top expense categories, month-to-date budget with over-budget flags and truncation notices.
- `delivery_status` only when non-null, in plain language (`not_configured` = saved, not emailed). Parse `facts` with zod; fall back to the summary text.

## 6. Cross-cutting requirements

- Switching companies must never show another company's cached data (test it).
- Viewers see no write controls (test it with MSW); owners/accountants do.
- Dashboard values must equal API values; add a test proving the UI recomputes nothing.
- Loading, empty, and error states on every screen; keyboard-usable forms and dialogs; usable down to tablet width.
- A brand-new company (no data) must look intentional, not broken.

## 7. Known gaps to handle rather than hide

- Categorization `failed` rows have no retry endpoint: show them under a status filter with inline manual category assignment.
- No token refresh: 401 handling is the mitigation.
- No members-list endpoint: the team page can only invite.
- No chat history and no digest list: handled as described above.
- Unverified until you check live: Decimal JSON shape, exact `facts` shapes, accepted upload file types, write roles on some PATCH/DELETE routes.

## 8. Operating contract

This section deliberately replaces the "agreed scope / ask before proceeding" parts of `AGENTS.md` **for this frontend build**. Everything else in `AGENTS.md` still binds you.

**You may, without asking:**
- Sequence the work however you judge best; work in coherent milestones.
- Make design, structure, and library choices inside Section 4; add justified dependencies.
- Make the backend changes in Section 3, run the backend and frontend test suites, and run local servers.
- Cut scope from the bottom of Section 5 if needed, with reasons recorded.

**You must not:**
- Commit, push, reset, or rewrite Git history. Leave changes in the working tree. (The human commits.)
- Apply migrations anywhere except `finpilot_test`.
- Make real Anthropic API calls in tests, or print or log secrets.
- Weaken tenant isolation, role checks, or the LLM constraints (LLM never calculates or writes; outputs validated).
- Add refresh tokens, cookie auth, or CORS middleware.

**Stop and report only if** you are genuinely blocked (missing credentials or services you cannot run), or a change would require a decision outside this document (a security-model change, a destructive data action). Otherwise keep going. For uncertainty inside your authority, choose the more conservative option, record it, and continue.

**Record as you go:**
- Append meaningful milestones, decisions, additions, and cut items to `docs/ENGINEERING_LOG.md`.
- Flag concepts the human should revisit in `docs/LEARNING_LOG.md` (without inventing personal entries).
- Update `docs/ARCHITECTURE.md` and `docs/REQUIREMENTS.md` where your backend changes make them stale.
- Write the repo `README.md` (it is currently empty): setup for backend and frontend, how to run tests, how to run the stack, and a short demo script.

## 9. Definition of done

- Every Must-have screen works for all three roles with correct gating, against the real backend.
- Backend suite passes with the new changes; frontend lint, typecheck, and tests pass. Report actual output, never assumed results.
- `docker compose up` (or a documented equivalent) serves the app on a single origin, or, if that cannot be verified in your environment, say exactly what was and was not verified.
- Final report (below) delivered.

## 10. Final report

When done, report in this order, concisely:
1. What was built, as a short big-picture view by feature; what was cut and why.
2. Backend changes and every migration (for manual review before use).
3. Decisions you made that were not dictated here, and any contradictions found between this file and the code.
4. Commands run with actual outcomes (tests, lint, typecheck, build); anything not verified.
5. Risks, known gaps, and the three concepts in this build most worth the human studying.
