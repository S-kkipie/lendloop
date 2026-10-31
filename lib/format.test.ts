import { describe, expect, it } from "vitest";
import { dayCount, firstName, formatDay, formatRange, formatTimestamp, inSentence, relativeTime } from "./format";

describe("formatDay", () => {
  it.each([
    ["2026-11-18", "Nov 18"],
    ["2026-01-01", "Jan 1"],
    ["2026-12-31", "Dec 31"],
  ])("%s → %s", (day, expected) => {
    expect(formatDay(day)).toBe(expected);
  });

  it("treats the string as a calendar day, whatever the process time zone", () => {
    // Midnight UTC is still the previous evening in the Americas; the label must not shift.
    expect(formatDay("2026-11-01")).toBe("Nov 1");
  });

  it("rejects strings that are not YYYY-MM-DD days", () => {
    expect(() => formatDay("2026-13-01")).toThrow(RangeError);
    expect(() => formatDay("18/11/2026")).toThrow(RangeError);
    expect(() => formatDay("2026-02-30")).toThrow(RangeError);
  });
});

describe("formatRange", () => {
  it.each([
    ["2026-11-08", "2026-11-12", "Nov 8 to Nov 12"],
    ["2026-11-30", "2026-12-02", "Nov 30 to Dec 2"],
    ["2026-12-30", "2027-01-02", "Dec 30, 2026 to Jan 2, 2027"],
    ["2026-11-18", "2026-11-18", "Nov 18"],
  ])("%s, %s → %s", (start, end, expected) => {
    expect(formatRange(start, end)).toBe(expected);
  });
});

describe("dayCount", () => {
  it.each([
    ["2026-11-18", "2026-11-18", "1 day"],
    ["2026-11-18", "2026-11-20", "3 days"],
    ["2026-11-30", "2026-12-02", "3 days"],
    ["2026-12-30", "2027-01-02", "4 days"],
    ["2026-03-28", "2026-03-30", "3 days"], // across a DST change in Europe
  ])("%s, %s → %s", (start, end, expected) => {
    expect(dayCount(start, end)).toBe(expected);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 10, 18, 12, 0, 0); // Nov 18, 2026 12:00 UTC
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  it.each([
    [now, "just now"],
    [now - 30_000, "just now"],
    [now + 5_000, "just now"], // small clock skew never shows "in the future"
    [now - min, "1 min ago"],
    [now - 5 * min, "5 min ago"],
    [now - 59 * min, "59 min ago"],
    [now - hour, "1 hour ago"],
    [now - 2 * hour, "2 hours ago"],
    [now - 23 * hour, "23 hours ago"],
    [now - day, "1 day ago"],
    [now - 2 * day, "2 days ago"],
    [now - 6 * day, "6 days ago"],
    [now - 7 * day, "Nov 11"],
    [Date.UTC(2025, 11, 30, 9, 0), "Dec 30, 2025"],
  ])("%i → %s", (at, expected) => {
    expect(relativeTime(at, now, "UTC")).toBe(expected);
  });

  it("uses the viewer's time zone for the calendar day of older events", () => {
    const at = Date.UTC(2026, 10, 11, 2, 0); // Nov 11 02:00 UTC is Nov 10 evening in New York
    expect(relativeTime(at, now, "America/New_York")).toBe("Nov 10");
  });
});

describe("firstName", () => {
  it.each([
    ["Marta R.", "Marta"],
    ["  Joaquín P. ", "Joaquín"],
    ["Mary Jane W.", "Mary Jane"],
    ["Former neighbour", "Former neighbour"],
    ["Ana", "Ana"],
  ])("%s → %s", (name, expected) => {
    expect(firstName(name)).toBe(expected);
  });
});

describe("inSentence", () => {
  it.each([
    ["Orbital sander", "orbital sander"],
    ["Cordless drill", "cordless drill"],
    ["Ébano chair", "ébano chair"],
    ["DeWalt drill", "DeWalt drill"],
    ["XL ladder", "XL ladder"],
    ["3 m ladder", "3 m ladder"],
    ["iPad stand", "iPad stand"],
  ])("%s → %s", (name, expected) => {
    expect(inSentence(name)).toBe(expected);
  });
});

describe("formatTimestamp", () => {
  it("formats a 24-hour time with the date", () => {
    const at = new Date(2026, 9, 31, 16, 42).getTime(); // local time
    expect(formatTimestamp(at)).toBe("Oct 31, 2026, 16:42");
  });
});
