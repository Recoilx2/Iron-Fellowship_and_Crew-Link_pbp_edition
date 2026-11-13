import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the campaign screen (spec #9), run against one real
 * local stack copy started from the Compose template plus its site
 * container -- the same copy the `live` job's behavior tests use.
 *
 * The stack is not started here: `npm run test:e2e` (supabase/tests/e2e.sh)
 * expects a copy already running and fails loudly when it is missing, so a
 * misconfigured run can never pass silently. In CI the `e2e` job in
 * .github/workflows/supabase-smoke.yml starts the copy first.
 *
 * Sessions are handed to the browser from Auth Admin API people (see
 * e2e/fixtures.ts), the same pattern as src/api-calls/testing/liveHarness.ts:
 * no mail server is involved.
 */
const siteUrl = process.env.E2E_SITE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./playwright-report" }],
    ["json", { outputFile: "./test-results/e2e-report.json" }],
  ],
  use: {
    baseURL: siteUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
