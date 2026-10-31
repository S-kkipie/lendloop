import { afterEach, expect, test, vi } from "vitest";
import { log, redact, sanitizeError } from "./logger";

afterEach(() => vi.restoreAllMocks());

test("redact masks personal keys and email-shaped strings, recursively", () => {
  expect(
    redact({
      event: "x",
      email: "ana@example.com",
      recipient: { email: "a@b.co", firstName: "Ana" },
      note: "contact ana@example.com today",
      nested: [{ name: "Ana Pérez", count: 2 }],
    }),
  ).toEqual({
    event: "x",
    email: "[redacted]",
    recipient: "[redacted]",
    note: "contact [email] today",
    nested: [{ name: "[redacted]", count: 2 }],
  });
});

test("sanitizeError strips emails, collapses whitespace and truncates", () => {
  expect(sanitizeError("Failed for ana@example.com\n  retry", 300)).toBe("Failed for [email] retry");
  expect(sanitizeError("x".repeat(400)).length).toBe(300);
});

test("log writes one redacted JSON line", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log.info("outbox.delivered", { eventId: "e1", email: "ana@example.com" });
  const line = JSON.parse(spy.mock.calls[0][0] as string);
  expect(line).toEqual({ level: "info", event: "outbox.delivered", eventId: "e1", email: "[redacted]" });
});
