import { expect, test, type Page } from "@playwright/test";

type Membership = {
  company_id: string;
  name: string;
  currency_code: string;
  created_at: string;
  role: "owner" | "accountant" | "viewer";
  permissions: string[];
};

const ownerPermissions = [
  "dashboard:read", "transactions:read", "invoices:read", "digests:read", "anomalies:read",
  "chat:ask", "invoice:upload", "invoice:review", "invoices:manage", "transaction:categorize",
  "transaction:manage", "categories:manage", "budgets:manage", "company:edit", "members:manage",
  "company:currency", "company:delete", "owner:grant",
];
const viewerPermissions = ["dashboard:read", "transactions:read", "invoices:read", "digests:read", "anomalies:read", "chat:ask"];

function membership(companyId: string, name: string, role: Membership["role"]): Membership {
  return {
    company_id: companyId,
    name,
    currency_code: "USD",
    created_at: "2026-10-01T12:00:00Z",
    role,
    permissions: role === "owner" ? ownerPermissions : viewerPermissions,
  };
}

async function signInWithMockedApi(page: Page, companies: Membership[], email: string) {
  const user = {
    id: "supabase-e2e-user",
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "E2E User", email_verified: true },
    created_at: "2026-10-01T12:00:00Z",
  };

  await page.route("**/auth/v1/token*", (route) => route.fulfill({
    json: {
      access_token: "e2e-auth-token", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "e2e-refresh-token", user,
    },
  }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ json: { id: "user-e2e", email, full_name: "E2E User", avatar_url: null, created_at: user.created_at } });
    } else if (path.endsWith("/companies")) {
      await route.fulfill({ json: companies });
    } else if (path.endsWith("/categories")) {
      await route.fulfill({ json: [] });
    } else if (path.endsWith("/transactions")) {
      const companyId = path.split("/").at(-2) ?? "";
      const description = companyId === "company-a" ? "Private company A entry" : "Company B entry";
      const item = companyId === "company-a" ? {
        id: "transaction-a", company_id: companyId, date: "2026-11-11", amount: "-76.25",
        description, category_id: null, source: "manual", categorization_status: "done",
      } : {
        id: "transaction-b", company_id: companyId, date: "2026-11-11", amount: "19.50",
        description, category_id: null, source: "manual", categorization_status: "done",
      };
      await route.fulfill({ json: { items: [item], total: 1, offset: 0, limit: 50, has_more: false } });
    } else {
      await route.fulfill({ status: 204, body: "" });
    }
  });

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("switches between company-scoped transaction lists", async ({ page }) => {
  const companies = [
    membership("company-a", "Private Studio", "owner"),
    membership("company-b", "Shared Studio", "owner"),
  ];
  await signInWithMockedApi(page, companies, "owner@example.com");
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByRole("link").filter({ hasText: "Private Studio" }).click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("Private company A entry")).toBeVisible();

  await page.getByLabel("Switch company").selectOption("company-b");
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("Company B entry")).toBeVisible();
  await expect(page.getByText("Private company A entry")).toHaveCount(0);
});

test("keeps a viewer read-only and blocks an unrelated company URL", async ({ page }) => {
  await signInWithMockedApi(page, [membership("company-b", "Shared Studio", "viewer")], "viewer@example.com");
  await page.goto("/c/company-a/transactions");
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/c/company-b/transactions");
  await expect(page.getByText("Company B entry")).toBeVisible();
  await expect(page.getByRole("button", { name: "New transaction" })).toHaveCount(0);
  await expect(page.getByLabel("Switch company").locator("option")).toHaveCount(1);
});
