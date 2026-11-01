// Browser end-to-end tests (Chromium only). Run: pnpm e2e
// Prerequisites (local only, not in CI: they need a Clerk instance):
//   - .env.local with the Clerk development instance keys
//     (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY = sk_test_…)
//   - the local Convex deployment with ALLOW_DEV_TOOLS=true (teardown purges
//     the test users' rows through devtools:purgeE2E)
//   - once: pnpm exec playwright install chromium
//   - optional: pnpm stack:up, so the loan flow also checks n8n's emails
// `pnpm dev:convex` and `pnpm dev:next` are started here unless already running.
// Global setup creates two Clerk test users (+clerk_test emails, random
// passwords never stored) and the teardown deletes them.
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Clerk keys and the Convex URL, as `next dev` sees them. Values already in the
// environment win (process.loadEnvFile never overrides).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE_URL = "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // One worker: the specs share two Clerk test users and a dev server that
  // compiles routes on first hit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Convex decides "today" in APP_TIMEZONE (UTC locally); the calendar uses the browser's zone.
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: "pnpm dev:convex",
      url: "http://127.0.0.1:3211/health",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "pnpm dev:next",
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
