import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // today = 2026-11-02 (UTC)
});
afterEach(() => vi.useRealTimers());

const dates = { startDate: "2026-11-05", endDate: "2026-11-07" };

describe("request", () => {
  test("creates a pending loan, audits, and notifies the owner", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates, message: " For a shelf " });
    const state = await t.run(async (ctx) => ({
      loan: await ctx.db.get(loanId),
      events: await ctx.db.query("outboxEvents").collect(),
      audits: await ctx.db.query("auditLog").collect(),
    }));
    expect(state.loan).toMatchObject({ status: "pending", ownerId: w.alice.id, borrowerId: w.bob.id, message: "For a shelf" });
    expect(state.events).toMatchObject([{ type: "loan.requested", recipientId: w.alice.id, loanId }]);
    expect(state.audits.at(-1)).toMatchObject({ action: "loan.request", toStatus: "pending" });
  });

  test("owners can't borrow their own tool", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.alice.as.mutation(api.loans.request, { toolId: w.toolId, ...dates }), "INVALID");
  });

  test.each([
    [{ startDate: "2026-11-01", endDate: "2026-11-03" }],
    [{ startDate: "2026-11-07", endDate: "2026-11-05" }],
    [{ startDate: "2026-11-05", endDate: "2026-12-30" }],
    [{ startDate: "11/05/2026", endDate: "2026-11-07" }],
  ])("rejects invalid range %o", async (range) => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...range }), "INVALID");
  });

  test("rejects dates that overlap an approved loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "approved", borrowerId: w.carol.id });
    await expectCode(
      w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-07", endDate: "2026-11-08" }),
      "CONFLICT",
    );
  });

  test("one pending request per borrower per tool", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await expectCode(
      w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-20", endDate: "2026-11-21" }),
      "CONFLICT",
    );
  });

  test("rate limited to 10 per hour", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    for (let i = 0; i < 10; i++) {
      const toolId = await w.alice.as.mutation(api.tools.create, {
        name: `Clamp ${i + 10}`,
        category: "hand_tools",
        condition: "good",
        description: "",
      });
      await w.bob.as.mutation(api.loans.request, { toolId, ...dates });
    }
    const last = await w.alice.as.mutation(api.tools.create, {
      name: "Clamp 99",
      category: "hand_tools",
      condition: "good",
      description: "",
    });
    await expectCode(w.bob.as.mutation(api.loans.request, { toolId: last, ...dates }), "RATE_LIMITED");
  });
});

describe("approve and decline", () => {
  test("approve auto-declines overlapping pending requests", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const bobs = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    const carols = await w.carol.as.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-06",
      endDate: "2026-11-08",
    });
    const danas = await w.dana.as.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });

    expect(await w.alice.as.mutation(api.loans.approve, { loanId: bobs })).toEqual({ autoDeclined: 1 });

    const state = await t.run(async (ctx) => ({
      bob: await ctx.db.get(bobs),
      carol: await ctx.db.get(carols),
      dana: await ctx.db.get(danas),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.bob?.status).toBe("approved");
    expect(state.carol).toMatchObject({ status: "declined", closeReason: "dates_taken" });
    expect(state.dana?.status).toBe("pending");
    expect(state.events.filter((e) => e.type !== "loan.requested").map((e) => [e.type, e.recipientId])).toEqual([
      ["loan.approved", w.bob.id],
      ["loan.declined", w.carol.id],
    ]);
  });

  test("only the owner may approve; strangers can't see the request", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await expectCode(w.bob.as.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
    await expectCode(w.carol.as.mutation(api.loans.approve, { loanId }), "NOT_FOUND");
    await expectCode(w.dana.as.mutation(api.loans.approve, { loanId }), "NOT_FOUND");
  });

  test("cannot approve after the start date has passed", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { startDate: "2026-11-01", endDate: "2026-11-03" });
    await expectCode(w.alice.as.mutation(api.loans.approve, { loanId }), "INVALID");
  });

  test("decline closes with owner_declined and notifies the borrower", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await w.alice.as.mutation(api.loans.decline, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({ status: "declined", closeReason: "owner_declined" });
    await expectCode(w.alice.as.mutation(api.loans.decline, { loanId }), "CONFLICT");
  });
});
