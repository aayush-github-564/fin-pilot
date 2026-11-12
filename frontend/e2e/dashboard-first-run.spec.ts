import { expect, test, type Page } from "@playwright/test";

const companyId = "company-a";
const company = {
  company_id: companyId,
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
  permissions: ["dashboard:read", "transactions:read", "invoices:read", "digests:read", "anomalies:read", "chat:ask", "invoice:upload", "invoice:review", "invoices:manage", "transaction:categorize", "transaction:manage", "categories:manage", "budgets:manage", "company:edit", "members:manage", "company:currency", "company:delete", "owner:grant"],
};

type DocumentCounts = {
  total: number;
  processing: number;
  awaiting_review: number;
  confirmed: number;
  failed: number;
};

async function openDashboard(page: Page, counts: DocumentCounts) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/auth/v1/token*", (route) => route.fulfill({
    json: {
      access_token: "e2e-dashboard-token", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "e2e-refresh-token",
      user: { id: "supabase-user-a", aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Workspace Owner", email_verified: true }, created_at: company.created_at },
    },
  }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ json: { id: "user-a", email: "owner@example.com", full_name: "Workspace Owner", avatar_url: null, created_at: company.created_at } });
    } else if (path.endsWith("/companies")) {
      await route.fulfill({ json: [company] });
    } else if (path.endsWith("/metrics/documents")) {
      await route.fulfill({ json: counts });
    } else if (path.endsWith("/metrics/cash-flow")) {
      await route.fulfill({
        json: {
          start_date: "2026-10-01", end_date: "2026-11-11", granularity: "month",
          total_inflows: "1250.00", total_outflows: "700.00", net_cash_flow: "550.00",
          transaction_count: 2, average_monthly_outflow: "650.00", average_monthly_net_burn: "-550.00",
          cash_balance: null, runway_months: null, runway_status: "no_net_burn",
          buckets: [{ period_start: "2026-11-01", inflows: "1250.00", outflows: "700.00", net_cash_flow: "550.00", transaction_count: 2 }],
        },
      });
    } else if (path.endsWith("/metrics/budget-vs-actual")) {
      await route.fulfill({ json: { period: "2026-11", total_budgeted: "0.00", total_actual: "0.00", total_remaining: "0.00", items: [] } });
    } else if (path.endsWith("/transactions")) {
      await route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 5, has_more: false } });
    } else if (path.endsWith("/invoices")) {
      await route.fulfill({ json: [] });
    } else {
      await route.fulfill({ status: 204, body: "" });
    }
  });
  if (await page.getByRole("button", { name: "Sign out" }).count()) {
    await page.goto(`/c/${companyId}/dashboard`);
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${companyId}/dashboard$`));
  await page.goto(`/c/${companyId}/dashboard`);
}

test("first-run dashboard states and shared invoice upload flow", async ({ page }) => {
  await openDashboard(page, { total: 0, processing: 0, awaiting_review: 0, confirmed: 0, failed: 0 });
  await expect(page.getByRole("heading", { name: "Upload an invoice to get started" })).toBeVisible();
  await expect(page.getByText("Northstar Studio").first()).toBeVisible();
  await expect(page.getByText("USD").first()).toBeVisible();

  await page.getByRole("button", { name: "Upload invoice" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${companyId}/invoices#upload$`));
  await expect(page.locator("#invoice-direction")).toBeVisible();
  await expect(page.getByLabel("Invoice or receipt file")).toBeVisible();
  await expect(page.locator("#invoice-direction option")).toHaveCount(2);

  await openDashboard(page, { total: 1, processing: 0, awaiting_review: 1, confirmed: 0, failed: 0 });
  await expect(page.getByRole("heading", { name: "Confirm your first invoice" })).toBeVisible();

  await openDashboard(page, { total: 1, processing: 0, awaiting_review: 0, confirmed: 1, failed: 0 });
  await expect(page.getByRole("region", { name: "Drop an invoice to upload it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cash flow" })).toBeVisible();
  await expect(page.getByText("Cash-flow chart showing inflows and outflows.")).toBeAttached();

  const uploadBar = page.getByRole("region", { name: "Drop an invoice to upload it" });
  const transferredFileCount = await uploadBar.evaluate((element) => {
    const browser = globalThis as unknown as {
      File: new (parts: string[], name: string, options: { type: string }) => unknown;
      DataTransfer: new () => { items: { add(file: unknown): void }; files: { length: number } };
      DragEvent: new (type: string, init: { bubbles: boolean; cancelable: boolean; dataTransfer: unknown }) => Event;
    };
    const file = new browser.File(["sample"], "dropped-invoice.pdf", { type: "application/pdf" });
    const transfer = new browser.DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(new browser.DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new browser.DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new browser.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return transfer.files.length;
  });
  expect(transferredFileCount).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/c/${companyId}/invoices#upload$`));
  await expect(page.getByText("Selected file: dropped-invoice.pdf")).toBeVisible();
});
