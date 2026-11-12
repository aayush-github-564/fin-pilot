import { expect, test } from "@playwright/test";

const supabaseUser = {
  id: "supabase-user-a",
  aud: "authenticated",
  role: "authenticated",
  email: "new-owner@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "New Owner", email_verified: true },
  created_at: "2026-11-12T00:00:00Z",
};

const session = {
  access_token: "e2e-auth-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "e2e-refresh-token",
  user: supabaseUser,
};

test("email signup verifies a one-time code before opening workspaces", async ({ page }) => {
  await page.route("**/auth/v1/signup*", (route) => route.fulfill({ json: { user: supabaseUser, session: null } }));
  await page.route("**/auth/v1/verify*", (route) => route.fulfill({ json: session }));
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    json: { id: "user-a", email: supabaseUser.email, full_name: "New Owner", avatar_url: null, created_at: supabaseUser.created_at },
  }));
  await page.route("**/api/v1/companies", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/invitations/mine", (route) => route.fulfill({ json: [] }));

  await page.goto("/register");
  await page.getByLabel("Full name").fill("New Owner");
  await page.getByLabel("Email address").fill(supabaseUser.email);
  await page.getByLabel("Password", { exact: true }).fill("a-long-e2e-password");
  await page.getByLabel("Confirm password").fill("a-long-e2e-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await page.getByLabel("Six-digit code").fill("123456");
  await expect(page.getByText("Your company workspace starts here")).toBeVisible();
});
