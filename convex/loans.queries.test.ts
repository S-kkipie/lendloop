import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // 2026-11-02
});
afterEach(() => vi.useRealTimers());

test("myRequests shows display names and overdue state, never the message to the borrower", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await insertLoan(t, w, { status: "active", startDate: "2026-10-25", endDate: "2026-10-30", message: "secret" });
  const [row] = await w.bob.as.query(api.loans.myRequests, {});
  expect(row).toMatchObject({
    status: "active",
    overdue: true,
    daysOverdue: 3,
    owner: { displayName: "Alice M." },
    tool: { name: "Cordless drill" },
  });
  expect(row.message).toBeUndefined();
});

test("incoming shows the message to the owner and counts conflicts", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await w.bob.as.mutation(api.loans.request, {
    toolId: w.toolId,
    startDate: "2026-11-05",
    endDate: "2026-11-07",
    message: "For a shelf",
  });
  await w.carol.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-06", endDate: "2026-11-09" });
  const rows = await w.alice.as.query(api.loans.incoming, {});
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.conflicts === 1)).toBe(true);
  expect(rows.find((r) => r.borrower.displayName === "Bob K.")?.message).toBe("For a shelf");
});

test("timeline merges status changes and notifications, visible to parties and admins only", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await w.bob.as.mutation(api.loans.request, {
    toolId: w.toolId,
    startDate: "2026-11-05",
    endDate: "2026-11-07",
  });
  vi.setSystemTime(NOW + 60_000);
  await w.alice.as.mutation(api.loans.approve, { loanId });

  const view = await w.bob.as.query(api.loans.timeline, { loanId });
  expect(view.nextStep).toBe("handover");
  expect(view.entries.map((e) => e.kind)).toEqual(["status", "notification", "status", "notification"]);
  expect(view.entries[2]).toMatchObject({ kind: "status", action: "loan.approve", actor: "Alice M." });
  expect(view.entries[1]).toMatchObject({ kind: "notification", type: "loan.requested", recipient: "owner" });

  await w.dana.as.query(api.loans.timeline, { loanId });
  await expectCode(w.carol.as.query(api.loans.timeline, { loanId }), "NOT_FOUND");
});
