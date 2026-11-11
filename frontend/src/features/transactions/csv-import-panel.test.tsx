import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { CSVImportResult, Transaction, TransactionPage } from "./api";
import { CsvImportPanel } from "./csv-import-panel";
import { TransactionsPage } from "./transactions-page";
import { transactionListQueryKey } from "./hooks";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const emptyPage: TransactionPage = {
  items: [],
  total: 0,
  offset: 0,
  limit: 25,
  has_more: false,
};

const result: CSVImportResult = {
  rows_seen: 3,
  imported_count: 1,
  duplicate_count: 1,
  rejected_count: 1,
  rows: [
    { row_number: 2, status: "imported", transaction_id: "transaction-a", categorization_status: "pending" },
    { row_number: 3, status: "duplicate", transaction_id: "transaction-existing" },
    { row_number: 4, status: "rejected", error_code: "invalid_date", error_message: "Date must use a supported date format" },
  ],
};

const pendingTransaction: Transaction = {
  id: "transaction-a",
  company_id: company.company_id,
  date: "2026-11-04",
  amount: "-125.50",
  description: "November rent",
  category_id: null,
  source: "upload",
  categorization_status: "done",
  categorization_source: "rule",
  suggested_category_id: null,
  suggestion_confidence: null,
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKey = transactionListQueryKey(company.company_id, { offset: 0, limit: 25 });
  queryClient.setQueryData(listKey, emptyPage);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider company={company}>
        <CsvImportPanel companyId={company.company_id} currencyCode={company.currency_code} />
      </CompanyProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, listKey };
}

describe("CSV import panel", () => {
  it("uploads multipart data, refreshes pending categorization, and filters the row report", async () => {
    let uploadContentType: string | null = null;
    let importCalls = 0;
    server.use(
      http.post("*/api/v1/companies/company-a/transactions/import-csv", async ({ request }) => {
        importCalls += 1;
        uploadContentType = request.headers.get("content-type");
        return HttpResponse.json(result);
      }),
      http.get("*/api/v1/companies/company-a/transactions/transaction-a", () =>
        HttpResponse.json(pendingTransaction),
      ),
    );
    const user = userEvent.setup();
    const { queryClient, listKey } = renderPanel();

    expect(screen.getByText(/company accounting currency \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText(/03\/04\/2026 means 3 April 2026/)).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/CSV file/), new File([
      "Date,Description,Amount\n04/11/2026,November rent,-125.50",
    ], "statement.csv", { type: "text/csv" }));
    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    expect(await screen.findByRole("heading", { name: "Import results" })).toBeInTheDocument();
    expect(await screen.findByText("Transaction added to the company ledger.")).toBeInTheDocument();
    expect(uploadContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(importCalls).toBe(1);
    expect(within(screen.getByRole("table")).getByText("2")).toBeInTheDocument();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    await user.selectOptions(screen.getByLabelText("Filter report rows"), "rejected");
    expect(screen.getByText("Date must use a supported date format")).toBeInTheDocument();
    expect(screen.queryByText("This row matches a transaction already imported.")).not.toBeInTheDocument();
  });

  it("blocks a file over 5 MiB before sending it", async () => {
    let importCalls = 0;
    server.use(http.post("*/api/v1/companies/company-a/transactions/import-csv", () => {
      importCalls += 1;
      return HttpResponse.json(result);
    }));
    const user = userEvent.setup();
    renderPanel();

    await user.upload(screen.getByLabelText(/CSV file/), new File([
      "x".repeat(5 * 1024 * 1024 + 1),
    ], "too-large.csv", { type: "text/csv" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("exceeds the 5 MiB upload limit");
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
    expect(importCalls).toBe(0);
  });

  it("shows import controls only to writable company roles", async () => {
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json([])),
      http.get("*/api/v1/companies/company-a/transactions", () => HttpResponse.json(emptyPage)),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CompanyProvider company={{ ...company, role: "viewer" }}>
          <TransactionsPage />
        </CompanyProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("No transactions match these filters");
    expect(screen.queryByRole("button", { name: "Import CSV" })).not.toBeInTheDocument();
  });
});
