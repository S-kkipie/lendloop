import { expect, test } from "./support/fixtures";

test("⌘K / Ctrl+K opens the command palette, which navigates by keyboard", async ({ pageAs }) => {
  const page = await pageAs("borrower");
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search tools or jump to…");
  await expect(input).toBeFocused();
  await input.pressSequentially("Incoming");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/me\/incoming$/);
  await expect(page.getByRole("heading", { level: 1, name: "Incoming" })).toBeVisible();
  await expect(input).toBeHidden();

  // Escape closes it without navigating.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
  await expect(page).toHaveURL(/\/me\/incoming$/);
});
