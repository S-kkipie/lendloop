// Pure date helpers. Dates are "YYYY-MM-DD" strings; endDate is inclusive.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayIn(timeZone: string, now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInclusive(startDate: string, endDate: string): number {
  const span = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(span / DAY_MS) + 1;
}

export function isOverdue(loan: { status: string; endDate: string }, today: string): boolean {
  return loan.status === "active" && today > loan.endDate;
}

export function daysOverdue(endDate: string, today: string): number {
  return Math.max(0, daysInclusive(endDate, today) - 1);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type RangeProblem = "invalid_format" | "end_before_start" | "starts_in_past" | "too_long";

export function checkRequestedRange(
  startDate: string,
  endDate: string,
  today: string,
  maxDays: number,
): RangeProblem | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return "invalid_format";
  if (endDate < startDate) return "end_before_start";
  if (startDate < today) return "starts_in_past";
  if (daysInclusive(startDate, endDate) > maxDays) return "too_long";
  return null;
}
