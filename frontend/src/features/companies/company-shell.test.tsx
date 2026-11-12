import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "../../app/app";
import { AuthProvider } from "../../app/auth-context";
import { queryClient } from "../../app/query-client";
import { setAuthSession } from "../../test/auth-session";
import { formatMoney } from "../../lib/money";
import { server } from "../../test/server";
import type { CompanyMembership } from "./api";

const user = {
  id: "user-1",
  email: "member@example.com",
  full_name: "Company Member",
  avatar_url: null,
  created_at: "2026-11-05T12:00:00Z",
};

const workspaceA: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: null,
  created_at: "2026-10-01T12:00:00Z",
  role: "viewer",
  permissions: [],
};

const workspaceB: CompanyMembership = {
  company_id: "company-b",
  name: "Paper Birch Co.",
  currency_code: "USD",
  created_at: "2026-10-02T12:00:00Z",
  role: "accountant",
  permissions: [],
};

function renderAt(path: string) {
  setAuthSession("test-session-token");
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockMemberships(memberships: CompanyMembership[]) {
  server.use(
    http.get("*/api/v1/auth/me", () => HttpResponse.json(user)),
    http.get("*/api/v1/companies", () => HttpResponse.json(memberships)),
    http.get("*/api/v1/companies/:companyId/metrics/documents", () =>
      HttpResponse.json({ total: 1, processing: 0, awaiting_review: 0, confirmed: 1, failed: 0 }),
    ),
    http.get("*/api/v1/companies/:companyId/metrics/cash-flow", ({ params }) => {
      const inflows = params.companyId === "company-a" ? "100.00" : "900.00";
      return HttpResponse.json({
        start_date: "2026-10-01",
        end_date: "2026-11-05",
        granularity: "month",
        total_inflows: inflows,
        total_outflows: "0.00",
        net_cash_flow: inflows,
        transaction_count: 0,
        average_monthly_outflow: "0.00",
        average_monthly_net_burn: "0.00",
        cash_balance: null,
        runway_months: null,
        runway_status: "cash_balance_required",
        buckets: [],
      });
    }),
    http.get("*/api/v1/companies/:companyId/metrics/budget-vs-actual", () =>
      HttpResponse.json({
        period: "2026-11",
        total_budgeted: "0.00",
        total_actual: "0.00",
        total_remaining: "0.00",
        items: [],
      }),
    ),
    http.get("*/api/v1/companies/:companyId/transactions", () =>
      HttpResponse.json({ items: [], total: 0, offset: 0, limit: 5, has_more: false }),
    ),
  );
}

describe("company workspace shell", () => {
  it("keeps the selected company in the route and hides owner controls from viewers", async () => {
    mockMemberships([workspaceA, workspaceB]);
    const browser = userEvent.setup();
    renderAt("/c/company-a/dashboard");

    expect(
      await screen.findByRole(
        "heading",
        { name: "Cash-flow period" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(await screen.findAllByText(formatMoney("100.00", null))).not.toHaveLength(0);
    expect(screen.getAllByText("Viewer").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("ISO 4217 currency code")).not.toBeInTheDocument();

    await browser.selectOptions(screen.getByLabelText("Switch company"), "company-b");
    expect(await screen.findByRole("heading", { name: "Cash-flow period" })).toBeInTheDocument();
    expect(await screen.findAllByText(formatMoney("900.00", "USD"))).not.toHaveLength(0);
    expect(screen.queryByText(formatMoney("100.00", null))).not.toBeInTheDocument();
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    expect(screen.getByText("USD")).toBeInTheDocument();
  });

  it("lets an owner set a legacy company currency once", async () => {
    const ownerMembership: CompanyMembership = { ...workspaceA, role: "owner" };
    const currentMemberships = [ownerMembership];
    mockMemberships(currentMemberships);
    server.use(
      http.patch("*/api/v1/companies/company-a", async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ currency_code: "USD" });
        currentMemberships[0] = { ...ownerMembership, currency_code: "USD" };
        return HttpResponse.json({
          id: "company-a",
          name: "Northstar Studio",
          currency_code: "USD",
          created_at: workspaceA.created_at,
        });
      }),
    );
    const browser = userEvent.setup();
    renderAt("/c/company-a/dashboard");

    const currencyInput = await screen.findByLabelText("ISO 4217 currency code");
    await browser.clear(currencyInput);
    await browser.type(currencyInput, "usd");
    await browser.click(screen.getByRole("button", { name: "Set currency" }));

    expect(await screen.findByText("USD")).toBeInTheDocument();
    expect(screen.queryByLabelText("ISO 4217 currency code")).not.toBeInTheDocument();
  });
});
