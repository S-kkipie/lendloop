import { describe, expect, it } from "vitest";
import { CONDITIONS as SERVER_CONDITIONS } from "../convex/lib/validators";
import { CONDITIONS, conditionLabel } from "./conditions";

describe("conditions", () => {
  it("covers every server condition, in the same order", () => {
    expect(CONDITIONS.map((c) => c.slug)).toEqual([...SERVER_CONDITIONS]);
  });

  it.each([
    ["new", "New"],
    ["like_new", "Like new"],
    ["good", "Good"],
    ["fair", "Fair"],
  ])("labels %s as %s", (slug, label) => {
    expect(conditionLabel(slug)).toBe(label);
  });

  it("falls back to a neutral label for unknown values", () => {
    expect(conditionLabel("broken")).toBe("Used");
  });

  it("gives every condition a short hint", () => {
    for (const condition of CONDITIONS) expect(condition.hint.length).toBeGreaterThan(0);
  });
});
