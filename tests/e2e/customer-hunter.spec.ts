import { expect, test } from "@playwright/test";

const email = `hunter-e2e-${Date.now()}@example.com`;
const password = "HunterE2E-Pass-2026!";
const inviteCode = "hunter-e2e-invite";

test("Customer Hunter founder flow signs in, loads cockpit, triggers discovery, and opens sales tasks", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: "Sign up" }).click();
  await page.locator('input[type="email"]').fill(email);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(password);
  await passwords.nth(1).fill(inviteCode);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/$/);

  await page.goto("/hunter");
  await expect(page.getByRole("heading", { name: "Customer Hunter" })).toBeVisible();
  await expect(page.getByText(/customer acquisition setup has blockers|core acquisition ready|customer acquisition configuration ready/i)).toBeVisible();

  const discoveryResponse = page.waitForResponse((response) =>
    response.url().includes("/api/hunter/discover") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Find buyers now" }).click();
  const response = await discoveryResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Find buyers now" })).toBeEnabled();

  await page.getByRole("link", { name: /Sales tasks/ }).click();
  await expect(page).toHaveURL(/\/hunter\/tasks$/);
  await expect(page.getByRole("heading", { name: "Human sales tasks" })).toBeVisible();
  await expect(page.getByText("No pending human sales tasks.")).toBeVisible();
});
