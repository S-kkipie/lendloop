import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("cancel", () => {
  test("borrower cancels pending; owner is notified", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w);
    await w.bob.as.mutation(api.loans.cancel, { loanId });
    const state = await t.run(async (ctx) => ({
      loan: await ctx.db.get(loanId),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.loan).toMatchObject({ status: "cancelled", closeReason: "borrower_cancelled" });
    expect(state.events).toMatchObject([{ type: "loan.cancelled", recipientId: w.alice.id }]);
  });

  test("owner cancels approved; owner cannot cancel pending", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const pending = await insertLoan(t, w);
    await expectCode(w.alice.as.mutation(api.loans.cancel, { loanId: pending }), "CONFLICT");
    const approved = await insertLoan(t, w, { status: "approved", startDate: "2026-11-20", endDate: "2026-11-21" });
    await w.alice.as.mutation(api.loans.cancel, { loanId: approved });
    expect((await t.run((ctx) => ctx.db.get(approved)))?.closeReason).toBe("owner_cancelled");
  });

  test("nobody can cancel an active loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active" });
    await expectCode(w.bob.as.mutation(api.loans.cancel, { loanId }), "CONFLICT");
  });
});

describe("handOver and markReturned", () => {
  test("happy path approved → active → returned", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "approved" });
    await w.alice.as.mutation(api.loans.handOver, { loanId });
    await w.alice.as.mutation(api.loans.markReturned, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({
      status: "returned",
      handedOverAt: expect.any(Number),
      returnedAt: expect.any(Number),
      closedAt: expect.any(Number),
    });
  });

  test("borrower can't self-declare a return", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active" });
    await expectCode(w.bob.as.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
  });

  test("hand over is blocked while another loan is active", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-10-30", endDate: "2026-11-03" });
    const loanId = await insertLoan(t, w, { status: "approved" });
    await expectCode(w.alice.as.mutation(api.loans.handOver, { loanId }), "CONFLICT");
  });

  test("hand over is blocked after the booking ended", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "approved", startDate: "2026-10-28", endDate: "2026-11-01" });
    await expectCode(w.alice.as.mutation(api.loans.handOver, { loanId }), "INVALID");
  });
});
