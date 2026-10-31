import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  adminAccess,
  adminSearch,
  countText,
  deliveryExplainer,
  formatDuration,
  heartbeatView,
  parseAdminParams,
  REMINDER_SCHEDULE,
  RETRY_WAITS,
  shortId,
  undelivered,
  type AdminParams,
} from "./admin";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-31T18:00:00Z");
const params = (query: string) => parseAdminParams(new URLSearchParams(query));

describe("parseAdminParams", () => {
  test.each([
    ["", { tab: "loans", status: null, overdue: false, entity: null }],
    ["tab=automation", { tab: "automation", status: null, overdue: false, entity: null }],
    ["tab=nope&status=bogus", { tab: "loans", status: null, overdue: false, entity: null }],
    ["status=pending", { tab: "loans", status: "pending", overdue: false, entity: null }],
    ["overdue=1", { tab: "loans", status: null, overdue: true, entity: null }],
    ["tab=audit&entity=loan&id=%20abc%20", { tab: "audit", status: null, overdue: false, entity: { type: "loan", id: "abc" } }],
    // Half a filter is no filter: the API needs the type and the ID together.
    ["tab=audit&entity=loan", { tab: "audit", status: null, overdue: false, entity: null }],
    ["tab=audit&entity=planet&id=abc", { tab: "audit", status: null, overdue: false, entity: null }],
  ] satisfies [string, AdminParams][])("%s", (query, expected) => {
    expect(params(query)).toEqual(expected);
  });
});

describe("adminSearch", () => {
  const base: AdminParams = { tab: "loans", status: null, overdue: false, entity: null };
  test.each([
    [base, ""],
    [{ ...base, status: "active" }, "?status=active"],
    // Overdue implies handed over, so it wins over a status.
    [{ ...base, status: "pending", overdue: true }, "?overdue=1"],
    [{ ...base, tab: "users", status: "pending" }, "?tab=users"],
    [{ ...base, tab: "audit", entity: { type: "tool", id: "k57x" } }, "?tab=audit&entity=tool&id=k57x"],
  ] satisfies [AdminParams, string][])("%j → %s", (state, expected) => {
    expect(adminSearch(state)).toBe(expected);
  });

  test("round-trips through parseAdminParams", () => {
    const state: AdminParams = { tab: "audit", status: null, overdue: false, entity: { type: "outboxEvent", id: "jn79" } };
    expect(params(adminSearch(state).slice(1))).toEqual(state);
  });
});

test("shortId keeps the distinctive end of a Convex ID", () => {
  expect(shortId("jh735036aenwtv6aye3vg4pcws8hanxj")).toBe("…8hanxj");
  expect(shortId("abc")).toBe("abc");
});

test.each([
  [30_000, "30 s"],
  [120_000, "2 min"],
  [600_000, "10 min"],
  [HOUR, "1 h"],
  [26 * HOUR, "26 h"],
])("formatDuration(%i) is %s", (ms, text) => {
  expect(formatDuration(ms)).toBe(text);
});

test("the delivery explainer states the real retry schedule", () => {
  expect(RETRY_WAITS).toEqual(["30 s", "2 min", "10 min", "1 h"]);
  const text = deliveryExplainer();
  expect(text).toContain("HMAC-SHA256");
  expect(text).toContain("tries 5 times, waiting 30 s, 2 min, 10 min and 1 h between tries");
  expect(text).toContain("dead letter you can replay");
  expect(text).not.toMatch(/\u2014/);
});

test("the reminder schedule matches the n8n workflow", () => {
  const workflow = JSON.parse(readFileSync(new URL("../n8n/workflows/overdue-reminders.json", import.meta.url), "utf8")) as {
    nodes: { type: string; parameters: { rule?: { interval?: { triggerAtHour?: number; triggerAtMinute?: number }[] } } }[];
  };
  const trigger = workflow.nodes.find((node) => node.type.toLowerCase().includes("schedule"));
  const interval = trigger?.parameters.rule?.interval?.[0];
  const time = `${String(interval?.triggerAtHour).padStart(2, "0")}:${String(interval?.triggerAtMinute ?? 0).padStart(2, "0")}`;
  expect(REMINDER_SCHEDULE).toBe(`Daily at ${time}`);
});

describe("heartbeatView", () => {
  test("never ran is a problem", () => {
    expect(heartbeatView(null, true, NOW)).toEqual({ value: "Never ran", caption: "n8n hasn't checked in yet", danger: true });
  });
  test("a recent run reads as when it ran", () => {
    expect(heartbeatView(NOW - 3 * HOUR, false, NOW)).toEqual({ value: "Ran 3 hours ago", caption: "Daily at 09:00", danger: false });
    expect(heartbeatView(NOW - 10_000, false, NOW).value).toBe("Ran just now");
  });
  test("stale says when it last ran", () => {
    expect(heartbeatView(NOW - 49 * HOUR, true, NOW)).toEqual({ value: "Stale", caption: "Last run 2 days ago", danger: true });
  });
});

test("undelivered counts what has yet to reach n8n", () => {
  expect(undelivered({ pending: 2, retrying: 3, dead: 4, sent: 9 })).toBe(5);
  expect(undelivered({})).toBe(0);
});

test("countText flags a capped count", () => {
  expect(countText(12)).toBe("12");
  expect(countText(1000)).toBe("1,000+");
});

test("adminAccess follows the role from the token", () => {
  expect(adminAccess(undefined)).toBe("loading");
  expect(adminAccess({ role: "user" })).toBe("forbidden");
  expect(adminAccess({ role: "admin" })).toBe("admin");
});
