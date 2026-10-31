import { afterEach, expect, test, vi } from "vitest";
import { appTimeZone, today } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("defaults to UTC and ignores invalid zones", () => {
  vi.stubEnv("APP_TIMEZONE", "");
  expect(appTimeZone()).toBe("UTC");
  vi.stubEnv("APP_TIMEZONE", "Mars/Olympus");
  expect(appTimeZone()).toBe("UTC");
});

test("today() uses APP_TIMEZONE", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T02:30:00Z"));
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  expect(today()).toBe("2026-11-05");
});
