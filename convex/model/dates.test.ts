import { describe, expect, test } from "vitest";
import {
  addDays,
  checkRequestedRange,
  daysInclusive,
  daysOverdue,
  isIsoDate,
  isOverdue,
  isValidTimeZone,
  todayIn,
} from "./dates";

describe("isIsoDate", () => {
  test.each([
    ["2026-11-05", true],
    ["2026-02-28", true],
    ["2026-02-30", false],
    ["2026-1-05", false],
    ["05/11/2026", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe("todayIn", () => {
  const now = Date.parse("2026-11-06T02:30:00Z");
  test("UTC", () => expect(todayIn("UTC", now)).toBe("2026-11-06"));
  test("behind UTC rolls back a day", () => expect(todayIn("America/New_York", now)).toBe("2026-11-05"));
  test("ahead of UTC", () => expect(todayIn("Asia/Tokyo", now)).toBe("2026-11-06"));
});

test("addDays crosses month and year boundaries", () => {
  expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});

test("daysInclusive counts both ends", () => {
  expect(daysInclusive("2026-11-05", "2026-11-05")).toBe(1);
  expect(daysInclusive("2026-11-05", "2026-11-07")).toBe(3);
});

describe("isOverdue", () => {
  test("not overdue on the end date itself", () => {
    expect(isOverdue({ status: "active", endDate: "2026-11-05" }, "2026-11-05")).toBe(false);
  });
  test("overdue the day after", () => {
    expect(isOverdue({ status: "active", endDate: "2026-11-05" }, "2026-11-06")).toBe(true);
  });
  test("only active loans can be overdue", () => {
    expect(isOverdue({ status: "approved", endDate: "2026-11-05" }, "2026-11-06")).toBe(false);
  });
});

test("daysOverdue", () => {
  expect(daysOverdue("2026-11-05", "2026-11-05")).toBe(0);
  expect(daysOverdue("2026-11-05", "2026-11-08")).toBe(3);
});

test("isValidTimeZone", () => {
  expect(isValidTimeZone("America/Santiago")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
});

describe("checkRequestedRange", () => {
  const today = "2026-11-02";
  test.each([
    ["2026-11-05", "2026-11-07", null],
    ["2026-11-02", "2026-11-02", null],
    ["2026-11-5", "2026-11-07", "invalid_format"],
    ["2026-11-07", "2026-11-05", "end_before_start"],
    ["2026-11-01", "2026-11-03", "starts_in_past"],
    ["2026-11-05", "2026-12-05", "too_long"],
    ["2026-11-05", "2026-12-04", null],
  ] as const)("%s..%s → %s", (start, end, expected) => {
    expect(checkRequestedRange(start, end, today, 30)).toBe(expected);
  });
});
