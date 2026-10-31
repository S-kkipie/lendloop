import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, insertLoan, seedWorld, setupTest } from "../test.helpers";
import { PAYLOAD_KEYS } from "./contract";
import { enqueueEvent } from "./outbox";
import { buildNotificationPayload } from "./payloads";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("payload carries only allowlisted fields", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w, { message: "please bring the charger" });
  const payload = await t.run(async (ctx) => {
    const eventId = await enqueueEvent(ctx, { type: "loan.approved", recipientId: w.bob.id, loanId, toolId: w.toolId });
    return await buildNotificationPayload(ctx, (await ctx.db.get(eventId))!, "https://lendloop.test");
  });

  expect(payload).toMatchObject({
    schemaVersion: 1,
    type: "loan.approved",
    recipient: { email: "bob@example.com", firstName: "Bob" },
    tool: { name: "Cordless drill" },
    loan: { id: loanId, status: "pending", startDate: "2026-11-05", endDate: "2026-11-07" },
    counterpartFirstName: "Alice",
    actionUrl: `https://lendloop.test/loans/${loanId}`,
  });
  expect(Object.keys(payload!).sort()).toEqual([...PAYLOAD_KEYS.top]);
  expect(Object.keys(payload!.recipient).sort()).toEqual([...PAYLOAD_KEYS.recipient]);
  expect(Object.keys(payload!.tool).sort()).toEqual([...PAYLOAD_KEYS.tool]);
  expect(Object.keys(payload!.loan!).sort()).toEqual([...PAYLOAD_KEYS.loan]);
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain("please bring");
  expect(serialized).not.toContain("alice@example.com");
  expect(serialized).not.toContain("Moreno");
});

test("deleted recipients get no payload", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const payload = await t.run(async (ctx) => {
    const eventId = await enqueueEvent(ctx, { type: "listing.removed", recipientId: w.alice.id, toolId: w.toolId });
    await ctx.db.patch(w.alice.id, { deletedAt: Date.now() });
    return await buildNotificationPayload(ctx, (await ctx.db.get(eventId))!, "https://lendloop.test");
  });
  expect(payload).toBeNull();
});
