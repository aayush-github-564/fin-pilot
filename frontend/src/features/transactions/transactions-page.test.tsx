import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { Category, Transaction, TransactionPage } from "./api";
import { TransactionsPage } from "./transactions-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const categories: Category[] = [
  { id: "income-a", company_id: null, name: "Service income", kind: "income", parent_category_id: null },
  { id: "expense-a", company_id: null, name: "Office rent", kind: "expense", parent_category_id: null },
];

const transaction: Transaction = {
  id: "transaction-a",
  company_id: company.company_id,
  date: "2026-11-04",
  amount: "-125.50",
  description: "November rent",
  category_id: null,
  source: "manual",
  categorization_status: "needs_review",
  categorization_source: null,
  suggested_category_id: null,
  suggestion_confidence: null,
};

const emptyPage: TransactionPage = {
  items: [],
  total: 0,
  offset: 0,
  limit: 25,
  has_more: false,
};

function renderTransactions(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider company={{ ...company, role }}>
        <TransactionsPage />
      </CompanyProvider>
    </QueryClientProvider>,
  );
}

function installHandlers({
  page = emptyPage,
  onList,
  onCreate,
  onUpdate,
  onDelete,
}: {
  page?: TransactionPage;
  onList?: (url: URL) => void;
  onCreate?: (body: unknown) => void;
  onUpdate?: (body: unknown, id: string) => void;
  onDelete?: (id: string) => void;
} = {}) {
  server.use(
    http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
    http.get("*/api/v1/companies/company-a/transactions", ({ request }) => {
      onList?.(new URL(request.url));
      return HttpResponse.json(page);
    }),
    http.post("*/api/v1/companies/company-a/transactions", async ({ request }) => {
      onCreate?.(await request.json());
      return HttpResponse.json({ ...transaction, id: "created-a" }, { status: 201 });
    }),
    http.patch("*/api/v1/companies/company-a/transactions/:transactionId", async ({ request, params }) => {
      onUpdate?.(await request.json(), String(params.transactionId));
      return HttpResponse.json({ ...transaction, id: String(params.transactionId) });
    }),
    http.delete("*/api/v1/companies/company-a/transactions/:transactionId", ({ params }) => {
      onDelete?.(String(params.transactionId));
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

describe("transactions page", () => {
  it("shows a read-only ledger to viewers and sends filters to the server", async () => {
    const requestUrls: URL[] = [];
    installHandlers({
      page: { ...emptyPage, items: [transaction], total: 1 },
      onList: (url) => requestUrls.push(url),
    });
    const user = userEvent.setup();
    renderTransactions("viewer");

    expect(await screen.findByText("November rent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New transaction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit November rent/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category for November rent")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by direction"), "outflow");
    await user.selectOptions(screen.getByLabelText("Filter by review status"), "needs_review");
    await waitFor(() => {
      expect(requestUrls.some((url) =>
        url.searchParams.get("direction") === "outflow" &&
        url.searchParams.get("categorization_status") === "needs_review",
      )).toBe(true);
    });
  });

  it("saves a positive outflow entry with the signed amount and chosen category", async () => {
    let submittedBody: unknown;
    installHandlers({ onCreate: (body) => { submittedBody = body; } });
    const user = userEvent.setup();
    renderTransactions();

    await user.click(await screen.findByRole("button", { name: "New transaction" }));
    await user.type(screen.getByLabelText("Amount"), "125.50");
    await user.type(screen.getByLabelText("Description"), "November rent");
    await user.selectOptions(screen.getByTestId("transaction-category-select"), "expense-a");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    await waitFor(() => expect(submittedBody).toEqual({
      date: expect.any(String),
      amount: "-125.50",
      description: "November rent",
      category_id: "expense-a",
      source: "manual",
    }));
  });

  it("offers only matching category kinds for inline changes", async () => {
    const incomeTransaction: Transaction = {
      ...transaction,
      amount: "250.00",
      description: "Customer payment",
    };
    let submittedBody: unknown;
    installHandlers({
      page: { ...emptyPage, items: [incomeTransaction], total: 1 },
      onUpdate: (body) => { submittedBody = body; },
    });
    const user = userEvent.setup();
    renderTransactions();

    const categorySelect = await screen.findByLabelText("Category for Customer payment");
    const options = within(categorySelect).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Uncategorized", "Service income"]);

    await user.selectOptions(categorySelect, "income-a");
    await waitFor(() => expect(submittedBody).toEqual({ category_id: "income-a" }));
  });

  it("requires confirmation before deleting a row", async () => {
    let deletedId: string | undefined;
    installHandlers({
      page: { ...emptyPage, items: [transaction], total: 1 },
      onDelete: (id) => { deletedId = id; },
    });
    const user = userEvent.setup();
    renderTransactions();

    await user.click(await screen.findByRole("button", { name: "Delete November rent" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(deletedId).toBe("transaction-a"));
  });
});
