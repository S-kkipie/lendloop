import { expect, test } from "vitest";
import { overlapping, rangesOverlap } from "./overlap";

const r = (startDate: string, endDate: string) => ({ startDate, endDate });

test.each([
  [r("2026-11-05", "2026-11-07"), r("2026-11-07", "2026-11-09"), true], // shared end day
  [r("2026-11-05", "2026-11-07"), r("2026-11-08", "2026-11-09"), false], // adjacent
  [r("2026-11-05", "2026-11-10"), r("2026-11-06", "2026-11-07"), true], // contained
  [r("2026-11-06", "2026-11-06"), r("2026-11-05", "2026-11-07"), true], // single day inside
])("rangesOverlap(%o, %o) → %s", (a, b, expected) => {
  expect(rangesOverlap(a, b)).toBe(expected);
  expect(rangesOverlap(b, a)).toBe(expected);
});

test("overlapping filters candidates", () => {
  const candidates = [
    { id: 1, ...r("2026-11-01", "2026-11-04") },
    { id: 2, ...r("2026-11-04", "2026-11-06") },
    { id: 3, ...r("2026-11-09", "2026-11-12") },
  ];
  expect(overlapping(r("2026-11-05", "2026-11-08"), candidates).map((c) => c.id)).toEqual([2]);
});
