import { describe, expect, it } from "vitest";
import { CATEGORIES as SERVER_CATEGORIES } from "../convex/lib/validators";
import { CATEGORIES, categoryIcon, categoryLabel } from "./categories";

describe("CATEGORIES", () => {
  it("lists every server category once, in server order", () => {
    expect(CATEGORIES.map((c) => c.slug)).toEqual([...SERVER_CATEGORIES]);
  });

  it("has a Phosphor icon for every category", () => {
    for (const c of CATEGORIES) expect(c.icon).toBeTruthy();
    expect(new Set(CATEGORIES.map((c) => c.icon)).size).toBe(CATEGORIES.length);
  });
});

describe("categoryLabel", () => {
  it.each([
    ["power_tools", "Power tools"],
    ["hand_tools", "Hand tools"],
    ["garden", "Garden"],
    ["kitchen", "Kitchen"],
    ["camping", "Camping"],
    ["cleaning", "Cleaning"],
    ["ladders", "Ladders"],
    ["other", "Other"],
  ])("%s → %s", (slug, label) => {
    expect(categoryLabel(slug)).toBe(label);
  });

  it("falls back to Other for an unknown slug", () => {
    expect(categoryLabel("rockets")).toBe("Other");
    expect(categoryIcon("rockets")).toBe(categoryIcon("other"));
  });
});
