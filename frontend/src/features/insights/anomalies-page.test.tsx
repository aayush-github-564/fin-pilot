import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { TransactionDetailPage } from "../transactions/transaction-detail-page";
import type { Transaction } from "../transactions/api";
import { server } from "../../test/server";
import type { SpendingAnomalyReport } from "./api";
import { AnomaliesPage } from "./anomalies-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const report: SpendingAnomalyReport = {
  window_start: "2026-11-03",
  window_end: "2026-11-09",
  baseline_start: "2026-08-05",
  baseline_end: "2026-11-02",
  scanned_transactions: 12,
  scan_truncated: false,
  anomalies_truncated: false,
  anomalies: [{
    transaction_id: "transaction-a",
    date: "2026-11-09",
    description: "Acme Shop",
    category_name: "Office supplies",
    comparison_basis: "vendor",
    amount: "400.00",
    baseline_average: "100.00",
    baseline_transaction_count: 3,
    ratio_to_average: "4.00",
    z_score: "3.27",
    explanation: "This vendor expense is unusually high compared with its history.",
    explanation_source: "llm",
  }],
};

const transaction: Transaction = {
  id: "transaction-a",
  company_id: company.company_id,
  date: "2026-11-09",
  amount: "-400.00",
  description: "Acme Shop",
  category_id: null,
  source: "manual",
  categorization_status: "done",
  categorization_source: "rule",
  suggested_category_id: null,
  suggestion_confidence: null,
};

function renderAnomalies(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/c/${company.company_id}/anomalies`]}>
        <CompanyProvider company={{ ...company, role }}>
          <Routes>
            <Route path="/c/:companyId/anomalies" element={<AnomaliesPage />} />
            <Route path="/c/:companyId/transactions/:transactionId" element={<TransactionDetailPage />} />
          </Routes>
        </CompanyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("anomalies page", () => {
  it("runs only on request with bounded parameters, then shows detail and links to its transaction", async () => {
    let requestCount = 0;
    let requestedDays: string | null = null;
    let requestedBaseline: string | null = null;
    server.use(
      http.get("*/api/v1/companies/company-a/insights/anomalies", ({ request }) => {
        requestCount += 1;
        const url = new URL(request.url);
        requestedDays = url.searchParams.get("days");
        requestedBaseline = url.searchParams.get("baseline_days");
        return HttpResponse.json(report);
      }),
      http.get("*/api/v1/companies/company-a/transactions/transaction-a", () => HttpResponse.json(transaction)),
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderAnomalies();

    expect(requestCount).toBe(0);
    await user.clear(screen.getByLabelText("Recent scan window (1–90 days)"));
    await user.type(screen.getByLabelText("Recent scan window (1–90 days)"), "7");
    await user.clear(screen.getByLabelText("Earlier baseline window (30–730 days)"));
    await user.type(screen.getByLabelText("Earlier baseline window (30–730 days)"), "90");
    await user.click(screen.getByRole("button", { name: "Run anomaly scan" }));

    expect(await screen.findByText("This vendor expense is unusually high compared with its history.")).toBeInTheDocument();
    expect(requestedDays).toBe("7");
    expect(requestedBaseline).toBe("90");
    expect(screen.getByText("$400.00")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("3.27")).toBeInTheDocument();
    expect(screen.getByText("LLM explanation")).toBeInTheDocument();
    expect(screen.getByText("Vendor history")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "View transaction" }));
    expect(await screen.findByRole("heading", { name: "Acme Shop" })).toBeInTheDocument();
    expect(screen.getByText("Categorization source")).toBeInTheDocument();
    expect(requestCount).toBe(1);
  });

  it("shows empty and truncation states with the actual scan windows", async () => {
    server.use(http.get("*/api/v1/companies/company-a/insights/anomalies", () => HttpResponse.json({
      ...report,
      scanned_transactions: 1000,
      scan_truncated: true,
      anomalies_truncated: true,
      anomalies: [],
    })));
    const user = userEvent.setup();
    renderAnomalies("viewer");

    await user.click(screen.getByRole("button", { name: "Run anomaly scan" }));
    expect(await screen.findByText("No unusual expenses found")).toBeInTheDocument();
    expect(screen.getByText(/reached its transaction limit/)).toBeInTheDocument();
    expect(screen.getByText(/reached its anomaly limit/)).toBeInTheDocument();
    expect(screen.getAllByText(/Nov 3, 2026 – Nov 9, 2026/).length).toBeGreaterThan(0);
  });

  it("uses the short-lived company cache only after an explicit scan", async () => {
    let requestCount = 0;
    server.use(http.get("*/api/v1/companies/company-a/insights/anomalies", () => {
      requestCount += 1;
      return HttpResponse.json(report);
    }));
    const user = userEvent.setup();
    renderAnomalies();

    expect(requestCount).toBe(0);
    await user.click(screen.getByRole("button", { name: "Run anomaly scan" }));
    expect(await screen.findByText("Scan report")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run anomaly scan" }));
    await waitFor(() => expect(screen.getByText("Scan report")).toBeInTheDocument());
    expect(requestCount).toBe(1);
  });

  it("blocks values outside the endpoint bounds before making a request", async () => {
    let requestCount = 0;
    server.use(http.get("*/api/v1/companies/company-a/insights/anomalies", () => {
      requestCount += 1;
      return HttpResponse.json(report);
    }));
    const user = userEvent.setup();
    renderAnomalies();

    await user.clear(screen.getByLabelText("Recent scan window (1–90 days)"));
    await user.type(screen.getByLabelText("Recent scan window (1–90 days)"), "91");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter whole-day values within the ranges shown");
    expect(screen.getByRole("button", { name: "Run anomaly scan" })).toBeDisabled();
    expect(requestCount).toBe(0);
  });
});
