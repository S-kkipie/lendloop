import { expect, test } from "./support/fixtures";

test("a neighbour without the admin role sees no Admin link, and /admin says Admins only", async ({ pageAs }) => {
  const page = await pageAs("borrower");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Browse" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByText("Admins only")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
});
