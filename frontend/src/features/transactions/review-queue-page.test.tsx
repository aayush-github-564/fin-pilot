import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { Category, Transaction } from "./api";
import { ReviewQueuePage } from "./review-queue-page";

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
  suggested_category_id: "expense-a",
  suggestion_confidence: "0.87",
};

function renderReview(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider company={{ ...company, role }}>
        <ReviewQueuePage />
      </CompanyProvider>
    </QueryClientProvider>,
  );
}

function installHandlers({
  onAccept,
  onOverride,
  onList,
  conflict = false,
}: {
  onAccept?: () => void;
  onOverride?: (body: unknown) => void;
  onList?: () => void;
  conflict?: boolean;
} = {}) {
  let remaining = true;
  server.use(
    http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
    http.get("*/api/v1/companies/company-a/transactions/review", () => {
      onList?.();
      return HttpResponse.json(remaining ? [transaction] : []);
    }),
    http.post("*/api/v1/companies/company-a/transactions/:transactionId/accept-suggestion", () => {
      onAccept?.();
      if (conflict) return HttpResponse.json({ detail: "Suggestion is stale." }, { status: 409 });
      remaining = false;
      return HttpResponse.json({ ...transaction, category_id: "expense-a", categorization_status: "done" });
    }),
    http.patch("*/api/v1/companies/company-a/transactions/:transactionId", async ({ request }) => {
      onOverride?.(await request.json());
      remaining = false;
      return HttpResponse.json({ ...transaction, category_id: "expense-a", categorization_status: "done" });
    }),
  );
}

describe("review queue page", () => {
  it("accepts a suggestion and refreshes the queue", async () => {
    let acceptCount = 0;
    installHandlers({ onAccept: () => { acceptCount += 1; } });
    const user = userEvent.setup();
    renderReview();

    expect(await screen.findByText("November rent")).toBeInTheDocument();
    expect(screen.getByText("87% confidence")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept suggestion" }));

    expect(await screen.findByText("Nothing needs review")).toBeInTheDocument();
    expect(acceptCount).toBe(1);
  });

  it("limits override choices to the transaction direction and saves the category", async () => {
    let submittedBody: unknown;
    installHandlers({ onOverride: (body) => { submittedBody = body; } });
    const user = userEvent.setup();
    renderReview();

    const categorySelect = await screen.findByLabelText("Override category for November rent");
    expect(within(categorySelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Choose override",
      "Office rent",
    ]);
    await user.selectOptions(categorySelect, "expense-a");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(submittedBody).toEqual({ category_id: "expense-a" }));
    expect(await screen.findByText("Nothing needs review")).toBeInTheDocument();
  });

  it("shows review data without write controls to viewers", async () => {
    installHandlers();
    renderReview("viewer");

    expect(await screen.findByText("November rent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept suggestion" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Override category for November rent")).not.toBeInTheDocument();
  });

  it("refetches and informs on a conflict without retrying the mutation", async () => {
    let acceptCount = 0;
    let listCount = 0;
    installHandlers({
      conflict: true,
      onAccept: () => { acceptCount += 1; },
      onList: () => { listCount += 1; },
    });
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole("button", { name: "Accept suggestion" }));

    expect(await screen.findByText(/changed while you were reviewing it/)).toBeInTheDocument();
    await waitFor(() => expect(listCount).toBeGreaterThanOrEqual(2));
    expect(acceptCount).toBe(1);
  });
});
