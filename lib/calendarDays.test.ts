import { describe, expect, it } from "vitest";
import {
  bookedRangeOn,
  daysInclusive,
  earliestStartDay,
  fromDayString,
  overlapsBooked,
  shiftDay,
  toDayString,
} from "./calendarDays";

const BOOKED = [
  { startDate: "2026-11-07", endDate: "2026-11-09" },
  { startDate: "2026-11-20", endDate: "2026-11-20" },
];

describe("toDayString / fromDayString", () => {
  it.each([
    [new Date(2026, 10, 8), "2026-11-08"],
    [new Date(2026, 0, 1, 23, 59), "2026-01-01"],
    [new Date(2027, 11, 31, 0, 0, 1), "2027-12-31"],
  ])("formats %s as a local calendar day", (date, day) => {
    expect(toDayString(date)).toBe(day);
  });

  it("round-trips through a local midnight", () => {
    const date = fromDayString("2026-11-18");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 10, 18, 0]);
    expect(toDayString(date)).toBe("2026-11-18");
  });

  it("rejects anything that is not a calendar day", () => {
    expect(() => fromDayString("2026-02-30")).toThrow(RangeError);
    expect(() => fromDayString("Nov 18")).toThrow(RangeError);
  });
});

describe("shiftDay and daysInclusive", () => {
  it.each([
    ["2026-11-30", 1, "2026-12-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-11-08", 0, "2026-11-08"],
  ])("shiftDay(%s, %i) is %s", (day, by, expected) => {
    expect(shiftDay(day, by)).toBe(expected);
  });

  it.each([
    ["2026-11-08", "2026-11-08", 1],
    ["2026-11-08", "2026-11-12", 5],
    ["2026-12-30", "2027-01-02", 4],
  ])("daysInclusive(%s, %s) is %i", (start, end, expected) => {
    expect(daysInclusive(start, end)).toBe(expected);
  });
});

describe("earliestStartDay", () => {
  it("is the browser's day when it matches UTC", () => {
    expect(earliestStartDay(new Date(Date.UTC(2026, 10, 8, 12)), 0)).toBe("2026-11-08");
  });

  it("uses the UTC day when UTC is already tomorrow (evening west of Greenwich)", () => {
    // 21:00 in UTC-5 is 02:00 UTC the next day; the server's default "today" is UTC.
    expect(earliestStartDay(new Date(Date.UTC(2026, 10, 9, 2)), 300)).toBe("2026-11-09");
  });

  it("uses the browser's day when it is ahead of UTC (early morning east of Greenwich)", () => {
    // 07:00 in UTC+9 is 22:00 UTC the previous day.
    expect(earliestStartDay(new Date(Date.UTC(2026, 10, 8, 22)), -540)).toBe("2026-11-09");
  });
});

describe("booked ranges", () => {
  it.each([
    ["2026-11-01", "2026-11-06", false],
    ["2026-11-06", "2026-11-07", true],
    ["2026-11-08", "2026-11-08", true],
    ["2026-11-09", "2026-11-19", true],
    ["2026-11-10", "2026-11-19", false],
    ["2026-11-01", "2026-11-30", true],
  ])("overlapsBooked(%s, %s) is %s", (start, end, expected) => {
    expect(overlapsBooked(start, end, BOOKED)).toBe(expected);
  });

  it("finds the booking that covers a day", () => {
    expect(bookedRangeOn("2026-11-08", BOOKED)).toEqual(BOOKED[0]);
    expect(bookedRangeOn("2026-11-20", BOOKED)).toEqual(BOOKED[1]);
    expect(bookedRangeOn("2026-11-10", BOOKED)).toBeUndefined();
  });
});
