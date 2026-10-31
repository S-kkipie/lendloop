// Date and time formatting for the UI. Loan dates are calendar days
// ("YYYY-MM-DD") and are always formatted as UTC so the browser's time zone
// can never shift them by a day.

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthDayYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Midnight UTC of a "YYYY-MM-DD" calendar day, in ms. Throws on anything else. */
export function parseDay(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (match) {
    const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const ms = Date.UTC(year, month - 1, date);
    const check = new Date(ms);
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date) {
      return ms;
    }
  }
  throw new RangeError(`Expected a YYYY-MM-DD calendar day, got "${day}"`);
}

/** "2026-11-18" → "Nov 18" */
export function formatDay(day: string): string {
  return monthDay.format(parseDay(day));
}

/** "Nov 8 to Nov 12"; years appear only when the range crosses one. */
export function formatRange(start: string, end: string): string {
  if (start === end) return formatDay(start);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDay(start)} to ${formatDay(end)}`;
  return `${monthDayYear.format(parseDay(start))} to ${monthDayYear.format(parseDay(end))}`;
}

/** Inclusive length of a loan: "1 day", "3 days". */
export function dayCount(start: string, end: string): string {
  const days = Math.round((parseDay(end) - parseDay(start)) / MS_PER_DAY) + 1;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * "just now", "5 min ago", "2 hours ago", "2 days ago", then the calendar day
 * ("Nov 11", or "Dec 30, 2025" in another year) in the viewer's time zone.
 */
export function relativeTime(at: number, now: number = Date.now(), timeZone?: string): string {
  const elapsed = now - at;
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, "day");

  const yearOf = (ms: number) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(ms);
  const sameYear = yearOf(at) === yearOf(now);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(at);
}
