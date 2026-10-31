import { expect, test } from "vitest";
import { BACKOFF_MS, MAX_ATTEMPTS, classifyStatus, nextRetryDelay } from "./delivery";

test.each([
  [200, "delivered"],
  [202, "delivered"],
  [408, "retry"],
  [429, "retry"],
  [500, "retry"],
  [503, "retry"],
  [400, "dead"],
  [401, "dead"],
  [404, "dead"],
])("HTTP %i → %s", (status, outcome) => {
  expect(classifyStatus(status)).toBe(outcome);
});

test("backoff schedule then give up", () => {
  expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
  expect(nextRetryDelay(1)).toBe(30_000);
  expect(nextRetryDelay(4)).toBe(3_600_000);
  expect(nextRetryDelay(MAX_ATTEMPTS)).toBeNull();
});
