import { defineConfig, devices } from "playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: "customer-hunter-e2e-nextauth-secret",
      AUTH_PASSWORD: "hunter-e2e-invite",
      INTERNAL_API_SECRET: "customer-hunter-e2e-internal-secret",
      LINKI_DB_PATH: process.env.PLAYWRIGHT_DB_PATH || "./.customer-hunter-e2e.db",
      HUNTER_DISCOVERY_ENABLED: "false",
      HUNTER_RUNNER_INTERVAL_MS: "3600000",
    },
  },
});
