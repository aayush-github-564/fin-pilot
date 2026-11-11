import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiUrl = "http://127.0.0.1:8000/api/v1";
const password = "FinPilot-E2E-Password-2026!";

type Company = { id: string; name: string; currency_code: string };
type Account = { email: string; token: string };

async function createAccount(request: APIRequestContext, email: string): Promise<Account> {
  const registration = await request.post(`${apiUrl}/auth/register`, {
    data: { email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);

  const login = await request.post(`${apiUrl}/auth/login`, {
    form: { username: email, password },
  });
  const body = (await login.json()) as { access_token: string };
  expect(login.status()).toBe(200);
  return { email, token: body.access_token };
}

async function createCompany(
  request: APIRequestContext,
  account: Account,
  name: string,
): Promise<Company> {
  const response = await request.post(`${apiUrl}/companies`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: { name, currency_code: "USD" },
  });
  const body = (await response.json()) as Company;
  expect(response.status()).toBe(201);
  return body;
}

async function loginInBrowser(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/companies$/);
}

test("registers an account and creates the first company workspace", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  const companyName = `E2E Workspace ${randomUUID().slice(0, 8)}`;

  await page.goto("/register");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Your workspaces" })).toBeVisible();
  await page.getByLabel("Company name").fill(companyName);
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page).toHaveURL(/\/c\/[^/]+\/dashboard$/);
  await expect(page.getByText(companyName).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Company navigation" })).toContainText("Overview");
});

test("records a transaction in the selected company through the real API", async ({ page, request }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  const account = await createAccount(request, email);
  const company = await createCompany(request, account, `E2E Ledger ${randomUUID().slice(0, 8)}`);
  const description = `E2E transaction ${randomUUID().slice(0, 8)}`;

  await loginInBrowser(page, email);
  await page.getByRole("link").filter({ hasText: company.name }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${company.id}/dashboard$`));
  await page.getByRole("link", { name: "Transactions" }).click();
  await page.getByRole("button", { name: "New transaction" }).click();
  await page.getByLabel("Amount").fill("42.75");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill(description);
  await page.getByRole("button", { name: "Save transaction" }).click();

  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByText("$42.75")).toBeVisible();
});

test("switches company data and keeps a viewer read-only and company-scoped", async ({ page, request }) => {
  const ownerEmail = `e2e-owner-${randomUUID()}@example.com`;
  const accountantEmail = `e2e-accountant-${randomUUID()}@example.com`;
  const viewerEmail = `e2e-viewer-${randomUUID()}@example.com`;
  const owner = await createAccount(request, ownerEmail);
  const companyA = await createCompany(request, owner, `E2E Private ${randomUUID().slice(0, 8)}`);
  const companyB = await createCompany(request, owner, `E2E Shared ${randomUUID().slice(0, 8)}`);
  await createAccount(request, accountantEmail);
  const viewer = await createAccount(request, viewerEmail);

  const accountantInvite = await request.post(`${apiUrl}/companies/${companyB.id}/invite`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { email: accountantEmail, role: "accountant" },
  });
  expect(accountantInvite.status(), await accountantInvite.text()).toBe(201);
  const invite = await request.post(`${apiUrl}/companies/${companyB.id}/invite`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { email: viewerEmail, role: "viewer" },
  });
  expect(invite.status(), await invite.text()).toBe(201);

  const marker = `Private to company A ${randomUUID().slice(0, 8)}`;
  const transaction = await request.post(`${apiUrl}/companies/${companyA.id}/transactions`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: {
      date: "2026-11-11",
      amount: "-76.25",
      description: marker,
      category_id: null,
      source: "manual",
    },
  });
  expect(transaction.status(), await transaction.text()).toBe(201);

  await loginInBrowser(page, ownerEmail);
  await page.getByRole("link").filter({ hasText: companyA.name }).click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText(marker)).toBeVisible();

  await page.getByLabel("Switch company").selectOption(companyB.id);
  await expect(page).toHaveURL(new RegExp(`/c/${companyB.id}/dashboard$`));
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText(marker)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();

  await loginInBrowser(page, accountantEmail);
  await page.getByRole("link").filter({ hasText: companyB.name }).click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("accountant", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "New transaction" }).click();
  const accountantTransaction = `Accountant transaction ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Amount").fill("19.50");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill(accountantTransaction);
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText(accountantTransaction)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await loginInBrowser(page, viewerEmail);
  await page.getByRole("link").filter({ hasText: companyB.name }).click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("viewer", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New transaction" })).toHaveCount(0);
  await expect(page.getByLabel("Switch company").locator("option")).toHaveCount(1);

  const forbiddenWrite = await request.post(`${apiUrl}/companies/${companyB.id}/transactions`, {
    headers: { Authorization: `Bearer ${viewer.token}` },
    data: {
      date: "2026-11-11",
      amount: "1.00",
      description: "Viewer write must be denied",
      category_id: null,
      source: "manual",
    },
  });
  expect(forbiddenWrite.status(), await forbiddenWrite.text()).toBe(403);

  await page.goto(`/c/${companyA.id}/transactions`);
  await expect(page).toHaveURL(/\/companies$/);
  await expect(page.getByText(marker)).toHaveCount(0);
});
