import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "../test.helpers";
import { applyLoanTransition } from "./loanTransitions";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("approve patches, audits and enqueues in one go", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w);

  await t.run(async (ctx) => {
    const loan = (await ctx.db.get(loanId))!;
    const to = await applyLoanTransition(ctx, {
      loan,
      action: "approve",
      actor: "owner",
      actorId: w.alice.id,
      actorType: "user",
      notify: [{ type: "loan.approved", recipientId: w.bob.id }],
    });
    expect(to).toBe("approved");
  });

  const { loan, audits, events } = await t.run(async (ctx) => ({
    loan: await ctx.db.get(loanId),
    audits: await ctx.db.query("auditLog").collect(),
    events: await ctx.db.query("outboxEvents").collect(),
  }));
  expect(loan).toMatchObject({ status: "approved", approvedAt: expect.any(Number) });
  expect(loan!.approvedAt).toBeGreaterThanOrEqual(NOW);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: "loan.approve",
    entityType: "loan",
    entityId: loanId,
    fromStatus: "pending",
    toStatus: "approved",
    actorId: w.alice.id,
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "loan.approved",
    recipientId: w.bob.id,
    loanId,
    toolId: w.toolId,
    status: "pending",
    attempts: 0,
    schemaVersion: 1,
  });
  // IDs only: no personal data on outbox rows
  expect(Object.keys(events[0]).sort()).toEqual(
    ["_creationTime", "_id", "attempts", "loanId", "recipientId", "schemaVersion", "status", "toolId", "type"].sort(),
  );
});

test("terminal transitions record closeReason and closedAt", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w);
  await t.run(async (ctx) => {
    const loan = (await ctx.db.get(loanId))!;
    await applyLoanTransition(ctx, {
      loan,
      action: "decline",
      actor: "system",
      actorType: "system",
      closeReason: "dates_taken",
      notify: [],
    });
  });
  const loan = await t.run((ctx) => ctx.db.get(loanId));
  expect(loan).toMatchObject({ status: "declined", closeReason: "dates_taken", closedAt: expect.any(Number) });
});

test("rejected transition throws CONFLICT", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w, { status: "returned" });
  await expectCode(
    t.run(async (ctx) => {
      const loan = (await ctx.db.get(loanId))!;
      await applyLoanTransition(ctx, { loan, action: "approve", actor: "owner", actorType: "user", notify: [] });
    }),
    "CONFLICT",
  );
});
