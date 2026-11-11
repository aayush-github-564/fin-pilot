import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import type { Category } from "../categories/api";
import { server } from "../../test/server";
import type { Budget } from "./api";
import { BudgetsPage } from "./budgets-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const categories: Category[] = [
  { id: "expense-a", company_id: null, name: "Office rent", kind: "expense", parent_category_id: null },
  { id: "income-a", company_id: null, name: "Service income", kind: "income", parent_category_id: null },
];

function budget(overrides: Partial<Budget> = {}): Budget {
  return { id: "budget-a", company_id: company.company_id, category_id: "expense-a", period: "2026-11", limit_amount: "450.00", ...overrides };
}

function renderPage(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CompanyProvider company={{ ...company, role }}><BudgetsPage /></CompanyProvider></QueryClientProvider>);
}

describe("budgets page", () => {
  it("creates a monthly budget using an expense category only", async () => {
    let saved: Budget | null = null;
    let requestBody: unknown;
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.get("*/api/v1/companies/company-a/budgets", () => HttpResponse.json(saved ? [saved] : [])),
      http.post("*/api/v1/companies/company-a/budgets", async ({ request }) => {
        requestBody = await request.json();
        saved = budget({ period: "2026-12", limit_amount: "800.25" });
        return HttpResponse.json(saved, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/No budgets for/);
    await user.selectOptions(screen.getByLabelText("Expense category"), "expense-a");
    expect(screen.getByRole("option", { name: "Office rent · default" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Service income · default" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-12" } });
    await user.type(screen.getByLabelText("Budget limit"), "800.25");
    await user.click(screen.getByRole("button", { name: "Add budget" }));

    expect(await screen.findByText("Budget saved.")).toBeInTheDocument();
    expect(requestBody).toEqual({ category_id: "expense-a", period: "2026-12", limit_amount: "800.25" });
  });

  it("updates an existing budget and refreshes the server list", async () => {
    let saved = budget();
    let updateBody: unknown;
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.get("*/api/v1/companies/company-a/budgets", () => HttpResponse.json([saved])),
      http.patch("*/api/v1/companies/company-a/budgets/:budgetId", async ({ request }) => {
        updateBody = await request.json();
        saved = budget({ limit_amount: String((updateBody as { limit_amount: string }).limit_amount) });
        return HttpResponse.json(saved);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Office rent");
    await user.click(screen.getByRole("button", { name: "Edit Office rent budget for November 2026" }));
    const amountInput = screen.getAllByLabelText("Budget limit").at(-1)!;
    await user.clear(amountInput);
    await user.type(amountInput, "525.00");
    await user.click(screen.getByRole("button", { name: "Save budget" }));

    await waitFor(() => expect(updateBody).toEqual({ category_id: "expense-a", period: "2026-11", limit_amount: "525.00" }));
    await waitFor(() => expect(screen.getByText("$525.00")).toBeInTheDocument());
  });

  it("keeps budget write controls hidden from viewers", async () => {
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.get("*/api/v1/companies/company-a/budgets", () => HttpResponse.json([budget()])),
    );
    renderPage("viewer");

    await screen.findByText("Office rent");
    expect(screen.queryByRole("heading", { name: "Create a budget" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Office rent budget/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete Office rent budget/ })).not.toBeInTheDocument();
    expect(screen.getByText("$450.00")).toBeInTheDocument();
  });

  it("prevents duplicate budgets for the same category and month", async () => {
    let createCalled = false;
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.get("*/api/v1/companies/company-a/budgets", () => HttpResponse.json([budget()])),
      http.post("*/api/v1/companies/company-a/budgets", () => { createCalled = true; return HttpResponse.json(budget(), { status: 201 }); }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Office rent");
    await user.selectOptions(screen.getByLabelText("Expense category"), "expense-a");
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-11" } });
    await user.type(screen.getByLabelText("Budget limit"), "700.00");
    await user.click(screen.getByRole("button", { name: "Add budget" }));

    expect(await screen.findByText(/A budget already exists for this category and month/)).toBeInTheDocument();
    expect(createCalled).toBe(false);
  });
});
