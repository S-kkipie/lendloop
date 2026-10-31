import { expect, test } from "vitest";
import { HEARTBEAT_MAX_AGE_MS, isStale } from "./heartbeat";

test("stale after 26 hours or when the cron never checked in", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  expect(isStale(null, now)).toBe(true);
  expect(isStale(now - HEARTBEAT_MAX_AGE_MS + 1, now)).toBe(false);
  expect(isStale(now - HEARTBEAT_MAX_AGE_MS - 1, now)).toBe(true);
});
