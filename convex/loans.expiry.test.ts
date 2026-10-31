import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { NOW, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // 2026-11-02
});
afterEach(() => vi.useRealTimers());

test("expires stale pending and never-handed-over approved loans only", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const stalePending = await insertLoan(t, w, { startDate: "2026-11-01", endDate: "2026-11-03" });
  const todayPending = await insertLoan(t, w, { startDate: "2026-11-02", endDate: "2026-11-03", borrowerId: w.carol.id });
  const staleApproved = await insertLoan(t, w, { status: "approved", startDate: "2026-10-28", endDate: "2026-11-01" });
  const liveApproved = await insertLoan(t, w, { status: "approved", startDate: "2026-10-30", endDate: "2026-11-02" });
  const overdueActive = await insertLoan(t, w, { status: "active", startDate: "2026-10-20", endDate: "2026-10-25" });

  expect(await t.mutation(internal.loans.expireStale, {})).toEqual({ expired: 2 });

  const state = await t.run(async (ctx) => ({
    stalePending: await ctx.db.get(stalePending),
    todayPending: await ctx.db.get(todayPending),
    staleApproved: await ctx.db.get(staleApproved),
    liveApproved: await ctx.db.get(liveApproved),
    overdueActive: await ctx.db.get(overdueActive),
    events: await ctx.db.query("outboxEvents").collect(),
  }));
  expect(state.stalePending).toMatchObject({ status: "expired", closeReason: "start_passed" });
  expect(state.todayPending?.status).toBe("pending");
  expect(state.staleApproved).toMatchObject({ status: "expired", closeReason: "not_handed_over" });
  expect(state.liveApproved?.status).toBe("approved");
  expect(state.overdueActive?.status).toBe("active"); // overdue is derived, never expired
  expect(state.events.map((e) => [e.type, e.recipientId])).toEqual([
    ["loan.expired", w.bob.id],
    ["loan.expired", w.bob.id],
    ["loan.expired", w.alice.id],
  ]);
});
