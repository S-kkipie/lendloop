import { expect, seriousA11yViolations, test } from "./support/fixtures";

// Seeded owners (convex/seed.ts) and how signed-in neighbours see them ("Ana L.").
// "Marta R." alone is fine: the page's privacy copy uses it as its example.
const OWNER_NAMES = ["Marta Rodríguez", "Rodríguez", "Joaquín", "Pérez", "Ana L", "López"];
// lib/categories.ts labels (that module pulls in the icon set, which Node can't load here).
const CATEGORY_LABELS = new Set(["Power tools", "Hand tools", "Garden", "Kitchen", "Camping", "Cleaning", "Ladders", "Other"]);

test("the public landing lists tools by name and category only, with no owner data", async ({ page }) => {
  await page.goto("/");
  const register = page.getByRole("table", { name: /available right now/ });
  await expect(register.getByRole("row").nth(1)).toBeVisible();

  const rows = register.getByRole("rowgroup").nth(1).getByRole("row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const cells = await rows.nth(i).getByRole("cell").allInnerTexts();
    expect(cells, `row ${i + 1}: number, name, category and nothing else`).toHaveLength(3);
    expect(cells[0]).toMatch(/^\d{3}$/);
    expect(cells[1].trim().length).toBeGreaterThan(0);
    expect(CATEGORY_LABELS.has(cells[2].trim()), cells[2]).toBe(true);
  }

  // The whole document, including the inline RSC payload: no owner names.
  const html = await page.content();
  for (const name of OWNER_NAMES) expect(html, name).not.toContain(name);
  expect(await register.innerText()).not.toMatch(/Marta|Joaquín|Ana /);

  expect(await seriousA11yViolations(page)).toEqual([]);
});
