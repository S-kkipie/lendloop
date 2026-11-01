import { randomBytes } from "node:crypto";
import { e2eUser, expect, seriousA11yViolations, test } from "./support/fixtures";
import { automationStackIsUp, subjectsFor } from "./support/mailpit";

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const dayInUtc = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("owner lists a tool, a neighbour requests dates, the owner approves, the borrower sees it approved (and emailed)", async ({
  page,
  pageAs,
}) => {
  const owner = e2eUser("owner");
  const toolName = `Playwright ladder ${randomBytes(3).toString("hex")}`;

  // 1. The owner lists a tool.
  const ownerPage = await pageAs("owner");
  await ownerPage.goto("/tools/new");
  await ownerPage.getByLabel("Name").fill(toolName);
  await ownerPage.getByRole("combobox", { name: "Category" }).click();
  await ownerPage.getByRole("option", { name: "Ladders" }).click();
  await ownerPage.getByRole("combobox", { name: "Condition" }).click();
  await ownerPage.getByRole("option", { name: /^Good/ }).click();
  await ownerPage.getByLabel(/Description/).fill("Aluminium, 3 m. Created by the Playwright suite.");
  await ownerPage.getByRole("button", { name: "List tool" }).click();
  await expect(ownerPage.getByText(`${toolName} is listed`)).toBeVisible();
  await expect(ownerPage).toHaveURL(/\/tools\/(?!new$)[a-z0-9]{20,}$/);
  const toolPath = new URL(ownerPage.url()).pathname;

  // The public landing never carries the owner's name.
  await page.goto("/");
  await expect(page.getByRole("table", { name: /available right now/ })).toBeVisible();
  const landing = await page.content();
  expect(landing).not.toContain(owner.firstName);
  expect(landing).not.toContain(owner.lastName);

  // 2. A neighbour finds it and requests two days.
  const borrowerPage = await pageAs("borrower");
  await borrowerPage.goto("/tools");
  await expect(borrowerPage.getByRole("link", { name: new RegExp(escape(toolName)) })).toBeVisible();
  expect(await seriousA11yViolations(borrowerPage), "browse").toEqual([]);

  await borrowerPage.goto(toolPath);
  await expect(borrowerPage.getByRole("heading", { level: 1, name: toolName })).toBeVisible();
  expect(await seriousA11yViolations(borrowerPage), "tool detail").toEqual([]);
  const [start, end] = [dayInUtc(3), dayInUtc(4)].map((d) => new RegExp(`^${escape(longDate.format(d))}`));
  await borrowerPage.getByRole("button", { name: start }).click();
  await borrowerPage.getByRole("button", { name: end }).click();
  await borrowerPage.getByRole("button", { name: "Request dates" }).click();
  await expect(borrowerPage.getByText(/^Request sent to /)).toBeVisible();
  await expect(borrowerPage).toHaveURL(/\/me\/requests$/);
  const loanLink = borrowerPage.getByRole("link", { name: toolName, exact: true });
  const loanPath = await loanLink.getAttribute("href");
  expect(loanPath).toMatch(/^\/loans\/[a-z0-9]+$/);

  // 3. The owner sees it in Incoming and approves.
  await ownerPage.goto("/me/incoming");
  const row = ownerPage.locator("[aria-labelledby]").filter({ has: ownerPage.getByRole("link", { name: toolName, exact: true }) });
  await expect(row.getByRole("button", { name: /Approve/ })).toBeVisible();
  expect(await seriousA11yViolations(ownerPage), "incoming").toEqual([]);
  await row.getByRole("button", { name: /Approve/ }).click();
  await expect(ownerPage.getByText(/^Approved .*'s request$/)).toBeVisible();

  // 4. The borrower's timeline shows the approval (live, no reload needed).
  await borrowerPage.goto(loanPath!);
  await expect(borrowerPage.getByText(/^Approved by /)).toBeVisible();
  expect(await seriousA11yViolations(borrowerPage), "loan timeline").toEqual([]);

  // 5. With the automation stack up: both emails go out through n8n, and n8n's
  // signed write-backs flip the timeline entries to "sent" (which also means no
  // write-back is still in flight when the teardown purges these rows).
  if (!(await automationStackIsUp())) {
    test.info().annotations.push({ type: "skipped", description: "email checks: n8n/Mailpit not running (pnpm stack:up)" });
    return;
  }
  const borrower = e2eUser("borrower");
  await expect.poll(() => subjectsFor(owner.email), { timeout: 60_000 }).toContain(`${borrower.firstName} wants to borrow your ${toolName}`);
  await expect.poll(() => subjectsFor(borrower.email), { timeout: 60_000 }).toContain(`Your request for the ${toolName} was approved`);
  await expect(borrowerPage.getByText(`Email to ${owner.firstName} sent`)).toBeVisible({ timeout: 60_000 });
  await expect(borrowerPage.getByText("Email to you sent")).toBeVisible({ timeout: 60_000 });
});
