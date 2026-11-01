// Shared fixtures: every browser context reports CSP violations (each test
// fails on any), Clerk sign-in as one of the two test users, and axe checks.
import AxeBuilder from "@axe-core/playwright";
import { clerk } from "@clerk/testing/playwright";
import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import type { E2EUser } from "./clerk-users";

type Violation = { directive: string; blocked: string; source: string };
type Who = E2EUser["key"];

declare global {
  interface Window {
    __lendloopCsp?: (violation: Violation) => void;
  }
}

/** Collects securitypolicyviolation events from every page and navigation of the context. */
async function watchCsp(context: BrowserContext, sink: Violation[]) {
  await context.exposeBinding("__lendloopCsp", (_source, violation: Violation) => {
    sink.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__lendloopCsp?.({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile });
    });
  });
}

function contextOptions(testInfo: TestInfo) {
  const { baseURL, viewport, timezoneId, locale } = testInfo.project.use;
  return { baseURL, viewport, timezoneId, locale };
}

export function e2eUser(who: Who): E2EUser {
  const users = JSON.parse(process.env.E2E_USERS ?? "[]") as E2EUser[];
  const user = users.find((u) => u.key === who);
  if (!user) throw new Error("E2E users missing: run through `pnpm e2e` (global setup creates them)");
  return user;
}

/** Signs in with a server-side sign-in token (no password, no UI), then waits for the app to sync the user. */
export async function signIn(page: Page, who: Who) {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: e2eUser(who).email });
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Browse tools" })).toBeVisible();
}

/** Serious and critical axe findings (the Next dev overlay is not part of the app). */
export async function seriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
}

type Fixtures = {
  cspViolations: Violation[];
  /** A fresh, signed-in context per user (its own cookies), CSP-watched like the default one. */
  pageAs: (who: Who) => Promise<Page>;
};

// The fixture callback is named `provide`, not Playwright's usual `use`, so the
// React hooks lint rule doesn't mistake it for React's use().
export const test = base.extend<Fixtures>({
  cspViolations: async ({}, provide) => {
    const sink: Violation[] = [];
    await provide(sink);
    expect(sink, "Content-Security-Policy violations").toEqual([]);
  },
  context: async ({ context, cspViolations }, provide) => {
    await watchCsp(context, cspViolations);
    await provide(context);
  },
  pageAs: async ({ browser, cspViolations }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async (who) => {
      const context = await (browser as Browser).newContext(contextOptions(testInfo));
      opened.push(context);
      await watchCsp(context, cspViolations);
      const page = await context.newPage();
      await signIn(page, who);
      return page;
    });
    for (const context of opened) await context.close();
  },
});

export { expect };
