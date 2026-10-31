import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { HEARTBEAT_MAX_AGE_MS } from "./model/heartbeat";
import { NOW, expectCode, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("health reports counts, problems, unresolved errors and a stale heartbeat", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("outboxEvents", {
      type: "loan.requested",
      schemaVersion: 1,
      recipientId: w.alice.id,
      status: "dead",
      attempts: 5,
      lastError: "n8n responded 503",
    });
    await ctx.db.insert("outboxEvents", {
      type: "loan.approved",
      schemaVersion: 1,
      recipientId: w.bob.id,
      status: "sent",
      attempts: 1,
    });
    await ctx.db.insert("automationErrors", { workflow: "overdue-reminders", executionId: "e9", message: "SMTP timeout" });
    await ctx.db.insert("automationHeartbeats", {
      workflow: "overdue-reminders",
      lastCheckInAt: NOW - HEARTBEAT_MAX_AGE_MS - 1,
    });
  });
  const health = await w.dana.as.query(api.admin.automationHealth, {});
  expect(health.counts).toMatchObject({ dead: 1, sent: 1, pending: 0 });
  expect(health.problems).toMatchObject([{ type: "loan.requested", lastError: "n8n responded 503" }]);
  expect(health.errors).toMatchObject([{ workflow: "overdue-reminders", message: "SMTP timeout" }]);
  expect(health.heartbeat.stale).toBe(true);
});

test("replay creates a new pending event linked to the original; only for dead or failed", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const [deadId, sentId] = await t.run(async (ctx) => [
    await ctx.db.insert("outboxEvents", {
      type: "loan.requested",
      schemaVersion: 1,
      recipientId: w.alice.id,
      status: "dead",
      attempts: 5,
    }),
    await ctx.db.insert("outboxEvents", {
      type: "loan.requested",
      schemaVersion: 1,
      recipientId: w.alice.id,
      status: "sent",
      attempts: 1,
    }),
  ]);
  const replayId = await w.dana.as.mutation(api.admin.replayEvent, { eventId: deadId });
  expect(await t.run((ctx) => ctx.db.get(replayId))).toMatchObject({ status: "pending", attempts: 0, replayOf: deadId });
  await expectCode(w.dana.as.mutation(api.admin.replayEvent, { eventId: sentId }), "CONFLICT");
});

test("health marks problems that were already replayed, and replays that failed again", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const deadId = await t.run((ctx) =>
    ctx.db.insert("outboxEvents", {
      type: "loan.requested",
      schemaVersion: 1,
      recipientId: w.alice.id,
      status: "dead",
      attempts: 5,
      lastError: "n8n responded 503",
    }),
  );
  const before = await w.dana.as.query(api.admin.automationHealth, {});
  expect(before.problems).toMatchObject([{ _id: deadId, replayedAt: null }]);

  const replayId = await w.dana.as.mutation(api.admin.replayEvent, { eventId: deadId });
  const after = await w.dana.as.query(api.admin.automationHealth, {});
  // The replay is pending, so it is not a problem; the original is marked.
  expect(after.problems).toHaveLength(1);
  expect(after.problems[0]).toMatchObject({ _id: deadId, status: "dead" });
  expect(after.problems[0].replayedAt).toBeGreaterThanOrEqual(NOW);
  expect(after.problems[0].replayOf).toBeUndefined();

  await t.run((ctx) => ctx.db.patch(replayId, { status: "failed", lastError: "SMTP 451" }));
  const failedAgain = await w.dana.as.query(api.admin.automationHealth, {});
  expect(failedAgain.problems.find((p) => p._id === replayId)).toMatchObject({ replayOf: deadId, replayedAt: null });
});

test("resolving an error hides it from the health view", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const errorId = await t.run((ctx) =>
    ctx.db.insert("automationErrors", { workflow: "w", executionId: "e1", message: "m" }),
  );
  await w.dana.as.mutation(api.admin.resolveError, { errorId });
  expect((await w.dana.as.query(api.admin.automationHealth, {})).errors).toEqual([]);
});
