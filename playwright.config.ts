import { defineConfig, devices } from "@playwright/test";

/** E2E runs against a production build + a migrated, demo-seeded database (DEMO_PASSWORD). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm start", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 },
});
