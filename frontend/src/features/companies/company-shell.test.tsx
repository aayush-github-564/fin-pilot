import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "../../app/app";
import { AuthProvider } from "../../app/auth-context";
import { queryClient } from "../../app/query-client";
import { setAccessToken } from "../../lib/auth-token";
import { server } from "../../test/server";
import type { CompanyMembership } from "./api";

const user = {
  id: "user-1",
  email: "member@example.com",
  created_at: "2026-11-05T12:00:00Z",
};

const workspaceA: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: null,
  created_at: "2026-10-01T12:00:00Z",
  role: "viewer",
};

const workspaceB: CompanyMembership = {
  company_id: "company-b",
  name: "Paper Birch Co.",
  currency_code: "USD",
  created_at: "2026-10-02T12:00:00Z",
  role: "accountant",
};

function renderAt(path: string) {
  setAccessToken("test-session-token");
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
  );
}

describe("company workspace shell", () => {
  it("keeps the selected company in the route and hides owner controls from viewers", async () => {
    mockMemberships([workspaceA, workspaceB]);
    const browser = userEvent.setup();
    renderAt("/c/company-a/dashboard");

    expect(await screen.findByRole("heading", { name: "Welcome to Northstar Studio" })).toBeInTheDocument();
    expect(screen.getAllByText("viewer").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("ISO 4217 currency code")).not.toBeInTheDocument();

    await browser.selectOptions(screen.getByLabelText("Switch company"), "company-b");
    expect(await screen.findByRole("heading", { name: "Welcome to Paper Birch Co." })).toBeInTheDocument();
    expect(screen.getAllByText("accountant").length).toBeGreaterThan(0);
    expect(screen.getByText("USD")).toBeInTheDocument();
  });

  it("lets an owner set a legacy company currency once", async () => {
    const ownerMembership: CompanyMembership = { ...workspaceA, role: "owner" };
    const currentMemberships = [ownerMembership];
    server.use(
      http.get("*/api/v1/auth/me", () => HttpResponse.json(user)),
      http.get("*/api/v1/companies", () => HttpResponse.json(currentMemberships)),
    );
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
