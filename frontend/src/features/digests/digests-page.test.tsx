import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import { DigestsPage } from "./digests-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const facts = {
  period: { start: "2026-11-02", end: "2026-11-08" },
  current_week: { inflows: "500.00", outflows: "250.00", net_cash_flow: "250.00", transaction_count: 4 },
  previous_week: { start: "2026-10-26", end: "2026-11-01", inflows: "400.00", outflows: "200.00", net_cash_flow: "200.00", transaction_count: 3 },
  top_expense_categories: { items: [{ category_name: "Office rent", outflows: "250.00", transaction_count: 1 }], truncated: true },
  month_to_date_budget: {
    period: "2026-11", through_date: "2026-11-08", total_budgeted: "300.00", total_actual: "350.00", total_remaining: "-50.00", over_budget_count: 1,
    items: [{ category_name: "Office rent", category_kind: "expense", budgeted_amount: "300.00", actual_amount: "350.00", remaining_amount: "-50.00", transaction_count: 2, over_budget: true }],
    items_truncated: true,
  },
  signals: { activity: "transactions_recorded", net_cash_flow: "positive", inflows_trend: "increased", outflows_trend: "unchanged", month_to_date_budget: "over_budget" },
};

function digest(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    company_id: company.company_id,
    period_start: "2026-11-02",
    period_end: "2026-11-08",
    summary: "The week finished with positive net cash flow.",
    summary_source: "llm",
    facts,
    delivery_status: "not_configured",
    created_at: "2026-11-09T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CompanyProvider company={company}><DigestsPage /></CompanyProvider></QueryClientProvider>);
}

describe("weekly digest page", () => {
  it("loads latest by default and displays summary, provenance, delivery, facts and truncation", async () => {
    let requestUrl = "";
    server.use(http.get("*/api/v1/companies/company-a/digests/weekly", ({ request }) => {
      requestUrl = request.url;
      return HttpResponse.json(digest());
    }));
    renderPage();

    expect(await screen.findByText("The week finished with positive net cash flow.")).toBeInTheDocument();
    expect(new URL(requestUrl).searchParams.has("period_start")).toBe(false);
    expect(screen.getByText("AI-written summary")).toBeInTheDocument();
    expect(screen.getByText("Digest saved; email is not configured.")).toBeInTheDocument();
    expect(screen.getByText("This week compared with last week")).toBeInTheDocument();
    expect(screen.getAllByText("Office rent")).toHaveLength(2);
    expect(screen.getAllByText("Over budget")).toHaveLength(2);
    expect(screen.getByText(/Only the five largest expense categories/)).toBeInTheDocument();
    expect(screen.getByText(/Some budget categories are not shown/)).toBeInTheDocument();
  });

  it("moves by Monday calendar weeks and returns to latest", async () => {
    const requestedPeriods: (string | null)[] = [];
    server.use(http.get("*/api/v1/companies/company-a/digests/weekly", ({ request }) => {
      const url = new URL(request.url);
      const period = url.searchParams.get("period_start");
      requestedPeriods.push(period);
      return HttpResponse.json(digest(period ? { period_start: period, period_end: "2026-11-01" } : {}));
    }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("The week finished with positive net cash flow.");
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(requestedPeriods).toContain("2026-10-26"));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(requestedPeriods.filter((period) => period === null)).toHaveLength(2));
    expect(requestedPeriods).toEqual([null, "2026-10-26", null]);
  });

  it("treats missing weeks as a normal empty state", async () => {
    server.use(http.get("*/api/v1/companies/company-a/digests/weekly", () => HttpResponse.json({ detail: "Weekly digest not found" }, { status: 404 })));
    renderPage();
    expect(await screen.findByText("No digest for this week")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the summary available when facts fail validation", async () => {
    server.use(http.get("*/api/v1/companies/company-a/digests/weekly", () => HttpResponse.json(digest({ facts: { unexpected: true } }))));
    renderPage();
    expect(await screen.findByText("The week finished with positive net cash flow.")).toBeInTheDocument();
    expect(screen.getByText("Detailed figures are unavailable for this digest. The summary above is still available.")).toBeInTheDocument();
  });
});
