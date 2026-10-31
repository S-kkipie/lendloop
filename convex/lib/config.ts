import { isValidTimeZone, todayIn } from "../model/dates";

export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE;
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

export function today(): string {
  return todayIn(appTimeZone());
}
