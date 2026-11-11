import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { Category } from "./api";
import { CategoriesPage } from "./categories-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

const defaults: Category[] = [
  { id: "default-expense", company_id: null, name: "Office supplies", kind: "expense", parent_category_id: null },
  { id: "default-income", company_id: null, name: "Other income", kind: "income", parent_category_id: null },
];
const owned: Category[] = [
  { id: "parent-expense", company_id: company.company_id, name: "Operations", kind: "expense", parent_category_id: null },
  { id: "custom-expense", company_id: company.company_id, name: "Travel", kind: "expense", parent_category_id: "parent-expense" },
];

function renderPage(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CompanyProvider company={{ ...company, role }}><CategoriesPage /></CompanyProvider></QueryClientProvider>);
}

describe("categories page", () => {
  it("creates a company category with a same-kind parent", async () => {
    let requestBody: unknown;
    let categories = [...defaults, ...owned.slice(0, 1)];
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.post("*/api/v1/companies/company-a/categories", async ({ request }) => {
        requestBody = await request.json();
        const created: Category = { id: "custom-new", company_id: company.company_id, name: "Travel", kind: "expense", parent_category_id: "parent-expense" };
        categories = [...categories, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Office supplies");
    await user.click(screen.getByRole("button", { name: "New category" }));
    await user.type(screen.getByLabelText("Name"), "Travel");
    await user.selectOptions(screen.getByLabelText("Kind"), "expense");
    await user.selectOptions(screen.getByRole("combobox", { name: /Parent category \(optional\)/ }), "parent-expense");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() => expect(requestBody).toEqual({ name: "Travel", kind: "expense", parent_category_id: "parent-expense" }));
    expect(await screen.findByText("Travel")).toBeInTheDocument();
  });

  it("shows a 409 kind conflict inline and keeps the category editable", async () => {
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json([...defaults, owned[0]])),
      http.patch("*/api/v1/companies/company-a/categories/parent-expense", () => HttpResponse.json({ detail: "Category kind conflicts with linked transaction directions" }, { status: 409 })),
    );
    const user = userEvent.setup();
    renderPage("accountant");

    await screen.findByText("Operations");
    await user.click(screen.getByRole("button", { name: "Edit category Operations" }));
    await user.selectOptions(screen.getAllByLabelText("Kind").at(-1)!, "income");
    await user.click(screen.getByRole("button", { name: "Save category" }));

    expect(await screen.findByText("Category kind conflicts with linked transaction directions")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Kind").at(-1)).toHaveValue("income");
  });

  it("keeps default categories and viewer permissions read-only", async () => {
    server.use(http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json([...defaults, ...owned])));
    renderPage("viewer");

    await screen.findByText("Office supplies");
    expect(screen.getAllByText("Default · read-only")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "New category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit category Office supplies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit category Travel" })).not.toBeInTheDocument();
  });

  it("requires confirmation before deleting a company category", async () => {
    let categories = [...defaults, owned[0]];
    let deleteCalled = false;
    server.use(
      http.get("*/api/v1/companies/company-a/categories", () => HttpResponse.json(categories)),
      http.delete("*/api/v1/companies/company-a/categories/parent-expense", () => {
        deleteCalled = true;
        categories = defaults;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Operations");
    await user.click(screen.getByRole("button", { name: "Delete category Operations" }));
    expect(deleteCalled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.queryByText("Operations")).not.toBeInTheDocument());
  });
});
