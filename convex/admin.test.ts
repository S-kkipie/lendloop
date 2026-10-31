import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("regular users are forbidden", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await expectCode(w.alice.as.query(api.admin.listLoans, {}), "FORBIDDEN");
  await expectCode(w.alice.as.mutation(api.admin.setTrustedLender, { userId: w.alice.id, trusted: true }), "FORBIDDEN");
});

test("listUsers masks emails", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const users = await w.dana.as.query(api.admin.listUsers, {});
  const alice = users.find((u) => u._id === w.alice.id);
  expect(alice).toMatchObject({ displayName: "Alice M.", maskedEmail: "a***@example.com", listings: 1 });
  expect(JSON.stringify(users)).not.toContain("alice@example.com");
});

test("removeTool keeps the active loan, cancels open requests, notifies owner and borrowers", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const active = await insertLoan(t, w, { status: "active", startDate: "2026-10-30", endDate: "2026-11-03" });
  const pending = await insertLoan(t, w, { borrowerId: w.carol.id, startDate: "2026-11-10", endDate: "2026-11-11" });

  await expectCode(w.dana.as.mutation(api.admin.removeTool, { toolId: w.toolId, reason: "x" }), "INVALID");
  expect(await w.dana.as.mutation(api.admin.removeTool, { toolId: w.toolId, reason: "Unsafe item" })).toEqual({
    cancelledLoans: 1,
  });

  const state = await t.run(async (ctx) => ({
    tool: await ctx.db.get(w.toolId),
    active: await ctx.db.get(active),
    pending: await ctx.db.get(pending),
    events: await ctx.db.query("outboxEvents").collect(),
    audits: await ctx.db.query("auditLog").collect(),
  }));
  expect(state.tool).toMatchObject({ status: "removed", removalReason: "Unsafe item", removedBy: w.dana.id });
  expect(state.active?.status).toBe("active");
  expect(state.pending?.status).toBe("cancelled");
  expect(state.events.map((e) => [e.type, e.recipientId])).toEqual([
    ["listing.removed", w.carol.id],
    ["listing.removed", w.alice.id],
  ]);
  expect(state.audits.at(-1)).toMatchObject({ action: "tool.moderate", actorType: "admin", reason: "Unsafe item" });
});

test("setTrustedLender toggles and audits", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await w.dana.as.mutation(api.admin.setTrustedLender, { userId: w.alice.id, trusted: true });
  expect((await w.carol.as.query(api.tools.get, { toolId: w.toolId })).owner.isTrustedLender).toBe(true);
  const log = await w.dana.as.query(api.admin.auditLog, { entityType: "user", entityId: w.alice.id });
  expect(log).toMatchObject([{ action: "user.trust", actor: "Dana O." }]);
});

test("listLoans overdueOnly", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await insertLoan(t, w, { status: "active", startDate: "2026-10-20", endDate: "2026-10-25" });
  await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-11-01", endDate: "2026-11-04" });
  const rows = await w.dana.as.query(api.admin.listLoans, { overdueOnly: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ overdue: true, borrower: { displayName: "Bob K." } });
});
