// Calendar-day helpers for the booking calendar. react-day-picker works with
// local Date objects at midnight, the API with "YYYY-MM-DD" strings. These
// convert between the two without ever going through Date.UTC (DESIGN.md).

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface DayRange {
  startDate: string;
  endDate: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The local calendar day of a Date, as "YYYY-MM-DD". */
export function toDayString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a "YYYY-MM-DD" day. Throws on anything else. */
export function fromDayString(day: string): Date {
  const match = DAY_PATTERN.exec(day);
  if (match) {
    const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const local = new Date(year, month - 1, date);
    if (local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === date) return local;
  }
  throw new RangeError(`Expected a YYYY-MM-DD calendar day, got "${day}"`);
}

/** The day `by` days after (or before) `day`. Calendar arithmetic, immune to DST. */
export function shiftDay(day: string, by: number): string {
  const date = fromDayString(day);
  date.setDate(date.getDate() + by);
  return toDayString(date);
}

/** Inclusive length of a range in days: Nov 8 to Nov 8 is 1. */
export function daysInclusive(start: string, end: string): number {
  const [a, b] = [fromDayString(start), fromDayString(end)];
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / MS_PER_DAY) + 1;
}

/**
 * The first day a request may start. The server's "today" uses APP_TIMEZONE
 * (UTC by default), so in the evening west of Greenwich the browser's today is
 * already in the past for the server. Taking the later of the two days keeps
 * the calendar from offering a start day the server would reject.
 *
 * @param timezoneOffset minutes behind UTC, as Date#getTimezoneOffset returns.
 */
export function earliestStartDay(now: Date = new Date(), timezoneOffset: number = now.getTimezoneOffset()): string {
  const localDay = new Date(now.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 10);
  const utcDay = now.toISOString().slice(0, 10);
  return localDay > utcDay ? localDay : utcDay;
}

/** True when [start, end] shares at least one day with a booked range. */
export function overlapsBooked(start: string, end: string, booked: readonly DayRange[]): boolean {
  return booked.some((range) => start <= range.endDate && range.startDate <= end);
}

/** The booked range that covers `day`, if any. */
export function bookedRangeOn<T extends DayRange>(day: string, booked: readonly T[]): T | undefined {
  return booked.find((range) => range.startDate <= day && day <= range.endDate);
}

/**
 * The server's "today" for deadline checks (has a booking ended?). Convex
 * computes it in APP_TIMEZONE, UTC unless configured otherwise.
 */
export function serverToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
