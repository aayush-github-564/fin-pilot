import { expect, test } from "@playwright/test";

test("invitation preview carries its destination into account creation", async ({ page }) => {
  await page.route("**/api/v1/invite/invite-token", (route) => route.fulfill({
    json: {
      company_name: "Northstar Studio",
      role: "member",
      inviter_name: "Workspace Owner",
      invited_email: "new-member@example.com",
      status: "pending",
    },
  }));

  await page.goto("/invite/invite-token");
  await expect(page.getByRole("heading", { name: "Join Northstar Studio" })).toBeVisible();
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/register\?email=new-member%40example\.com&next=%2Finvite%2Finvite-token$/);
  await expect(page.getByLabel("Email address")).toHaveValue("new-member@example.com");
  await expect(page.getByLabel("Email address")).toHaveAttribute("readonly");
});
