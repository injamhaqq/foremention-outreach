import { expect, test } from "playwright/test";

const email = `hunter-e2e-${Date.now()}@example.com`;
const password = "HunterE2E-Pass-2026!";
const inviteCode = "hunter-e2e-invite";

test("Customer Hunter founder flow signs in, loads cockpit, respects readiness gates, and opens sales tasks", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: "Sign up" }).click();
  await page.locator('input[type="email"]').fill(email);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(password);
  await passwords.nth(1).fill(inviteCode);
  await page.getByRole("button", { name: "Create account" }).click();

  // Playwright retries reuse the same app process and SQLite file. If the first
  // attempt already created the one allowed admin, retry by signing in instead
  // of attempting to create a second admin.
  if (page.url().endsWith("/login")) {
    const closed = page.getByText(/signup is closed/i);
    if (await closed.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
  }

  await expect(page).toHaveURL(/\/$/);

  await page.goto("/hunter");
  await expect(page.getByRole("heading", { name: "Customer Hunter" })).toBeVisible();
  await expect(page.getByText(/customer acquisition setup has blockers|core acquisition ready|customer acquisition configuration ready/i)).toBeVisible();

  // The browser-acceptance environment intentionally has no persistent
  // production storage or live discovery provider. The UI must fail closed.
  await expect(page.getByRole("button", { name: "Find buyers now" })).toBeDisabled();
  await expect(page.getByText(/persistent storage|discovery disabled|no discovery provider/i)).toBeVisible();

  await page.getByRole("link", { name: /Sales tasks/ }).click();
  await expect(page).toHaveURL(/\/hunter\/tasks$/);
  await expect(page.getByRole("heading", { name: "Human sales tasks" })).toBeVisible();
  await expect(page.getByText("No pending human sales tasks.")).toBeVisible();
});
