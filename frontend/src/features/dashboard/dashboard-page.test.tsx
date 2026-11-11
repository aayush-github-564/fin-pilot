import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import { formatMoney } from "../../lib/money";
import { DashboardPage } from "./dashboard-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const cashFlow: components["schemas"]["CashFlowMetricsRead"] = {
  start_date: "2026-10-01",
  end_date: "2026-11-05",
  granularity: "month",
  total_inflows: "1234.56",
  total_outflows: "987.65",
  // Deliberately differs from inflows minus outflows; the UI must display this API value.
  net_cash_flow: "111.11",
  transaction_count: 3,
  average_monthly_outflow: "654.32",
  average_monthly_net_burn: "-25.00",
  cash_balance: null,
  runway_months: null,
  runway_status: "no_net_burn",
  buckets: [
    {
      period_start: "2026-10-01",
      inflows: "900.00",
      outflows: "700.00",
      net_cash_flow: "200.00",
      transaction_count: 2,
    },
    {
      period_start: "2026-11-01",
      inflows: "334.56",
      outflows: "287.65",
      net_cash_flow: "46.91",
      transaction_count: 1,
    },
  ],
};

const budgetReport: components["schemas"]["BudgetVsActualRead"] = {
  period: "2026-11",
  total_budgeted: "400.00",
  total_actual: "350.00",
  total_remaining: "50.00",
  items: [
    {
      category_id: "category-a",
      category_name: "Travel",
      category_kind: "expense",
      budgeted_amount: "400.00",
      actual_amount: "350.00",
      remaining_amount: "50.00",
      utilization_percent: "87.50",
      over_budget: false,
      transaction_count: 2,
    },
  ],
};

const recentTransactions: components["schemas"]["TransactionPageRead"] = {
  items: [
    {
      id: "transaction-a",
      company_id: company.company_id,
      date: "2026-11-04",
      amount: "-88.25",
      description: "Supplier payment",
      category_id: null,
      source: "manual",
      categorization_status: "done",
      categorization_source: "rule",
      suggested_category_id: null,
      suggestion_confidence: null,
    },
  ],
  total: 1,
  offset: 0,
  limit: 5,
  has_more: false,
};

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider company={company}>
        <DashboardPage />
      </CompanyProvider>
    </QueryClientProvider>,
  );
}

function installDashboardHandlers({
  cashFlowHandler,
  budgetHandler,
  requestUrls,
}: {
  cashFlowHandler?: (url: URL) => typeof cashFlow;
  budgetHandler?: (url: URL) => typeof budgetReport;
  requestUrls?: string[];
} = {}) {
  server.use(
    http.get("*/api/v1/companies/company-a/metrics/cash-flow", ({ request }) => {
      const url = new URL(request.url);
      requestUrls?.push(url.toString());
      return HttpResponse.json(cashFlowHandler?.(url) ?? cashFlow);
    }),
    http.get("*/api/v1/companies/company-a/metrics/budget-vs-actual", ({ request }) => {
      const url = new URL(request.url);
      requestUrls?.push(url.toString());
      return HttpResponse.json(budgetHandler?.(url) ?? budgetReport);
    }),
    http.get("*/api/v1/companies/company-a/transactions", ({ request }) => {
      const url = new URL(request.url);
      requestUrls?.push(url.toString());
      if (url.searchParams.get("categorization_status") === "needs_review") {
        return HttpResponse.json({ ...recentTransactions, total: 7, limit: 1 });
      }
      return HttpResponse.json(recentTransactions);
    }),
  );
}

describe("company dashboard", () => {
  it("renders backend totals, budget, review count, and recent activity without recomputing totals", async () => {
    installDashboardHandlers();
    renderDashboard();

    expect(await screen.findByText("Supplier payment")).toBeInTheDocument();
    const netCard = screen.getByText("Net cash flow").closest("section");
    expect(netCard).not.toBeNull();
    expect(within(netCard as HTMLElement).getByText(formatMoney(cashFlow.net_cash_flow, "USD"))).toBeInTheDocument();
    expect(screen.getByText("Generating cash")).toBeInTheDocument();
    expect(screen.getByText("No estimate needed")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.getAllByText(formatMoney("350.00", "USD"))).toHaveLength(2);
    expect(screen.getByText("Budget vs actual")).toBeInTheDocument();
  });

  it("sends selected granularity and cash balance to the metrics API", async () => {
    const user = userEvent.setup();
    const requestUrls: string[] = [];
    installDashboardHandlers({
      requestUrls,
      cashFlowHandler: (url) =>
        url.searchParams.has("cash_balance")
          ? {
              ...cashFlow,
              cash_balance: url.searchParams.get("cash_balance"),
              runway_months: "4.25",
              runway_status: "estimated",
            }
          : cashFlow,
    });
    renderDashboard();

    await screen.findByText("Supplier payment");
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await waitFor(() => {
      expect(requestUrls.some((value) => new URL(value).searchParams.get("granularity") === "day")).toBe(true);
    });

    await user.type(screen.getByLabelText("Current cash balance (optional)"), "25000.50");
    await user.click(screen.getByRole("button", { name: "Update runway estimate" }));
    await waitFor(() => {
      expect(requestUrls.some((value) => new URL(value).searchParams.get("cash_balance") === "25000.50")).toBe(true);
    });
    const runwayCard = screen.getByText("Runway").closest("section");
    expect(runwayCard).toHaveTextContent("4.25 months");
  });

  it("rejects a custom date range above 366 days and requests the selected budget month", async () => {
    const requestUrls: string[] = [];
    installDashboardHandlers({
      requestUrls,
      budgetHandler: (url) => ({ ...budgetReport, period: url.searchParams.get("period") ?? "" }),
    });
    renderDashboard();
    await screen.findByText("Supplier payment");

    const priorMetricRequestCount = requestUrls.filter((value) => value.includes("/metrics/cash-flow")).length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("366 days or fewer");
    expect(requestUrls.filter((value) => value.includes("/metrics/cash-flow"))).toHaveLength(priorMetricRequestCount);

    fireEvent.change(screen.getByLabelText("Budget month"), { target: { value: "2026-10" } });
    await waitFor(() => {
      expect(requestUrls.some((value) => new URL(value).searchParams.get("period") === "2026-10")).toBe(true);
    });
    fireEvent.change(screen.getByLabelText("Budget month"), { target: { value: "" } });
    expect(await screen.findByText("Choose a month to view its budget report.")).toBeInTheDocument();
  });
});
