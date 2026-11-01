import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, insertLoan, seedWorld, setupTest, type TestT } from "./test.helpers";

// Svix secrets are "whsec_" + base64 bytes. Generated per run so no
// secret-shaped literal lives in the repo (it triggered secret scanning).
const randomWebhookSecret = () => `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))}`;
const SECRET = randomWebhookSecret();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function post(t: TestT, event: unknown, secret = SECRET) {
  const payload = JSON.stringify(event);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const signature = new Webhook(secret).sign(id, new Date(now), payload);
  return await t.fetch("/clerk/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(now / 1000)),
      "svix-signature": signature,
    },
    body: payload,
  });
}

test("rejects bad signatures", async () => {
  const t = setupTest();
  const res = await post(t, { type: "user.deleted", data: { id: "user_alice" } }, randomWebhookSecret());
  expect(res.status).toBe(401);
});

test("forged requests never drain the rate-limit bucket", async () => {
  const t = setupTest();
  await seedWorld(t);
  // More forgeries than the bucket's capacity (120), then a real event.
  for (let i = 0; i < 150; i++) {
    expect((await post(t, { type: "user.deleted", data: { id: "user_alice" } }, randomWebhookSecret())).status).toBe(401);
  }
  const res = await post(t, { type: "user.deleted", data: { id: "user_nobody", deleted: true } });
  expect(res.status).toBe(200);
});

test("user.updated refreshes name and email", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const res = await post(t, {
    type: "user.updated",
    data: {
      id: "user_alice",
      first_name: "Alicia",
      last_name: "Moreno",
      primary_email_address_id: "e2",
      email_addresses: [
        { id: "e1", email_address: "old@example.com" },
        { id: "e2", email_address: "alicia@example.com" },
      ],
    },
  });
  expect(res.status).toBe(200);
  expect(await t.run((ctx) => ctx.db.get(w.alice.id))).toMatchObject({
    name: "Alicia Moreno",
    email: "alicia@example.com",
  });
});

test("user.deleted anonymizes, removes listings, cancels open requests, keeps active loans", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const ownersPending = await insertLoan(t, w); // bob borrows alice's tool
  const active = await insertLoan(t, w, {
    status: "active",
    borrowerId: w.carol.id,
    startDate: "2026-10-30",
    endDate: "2026-11-03",
  });

  expect((await post(t, { type: "user.deleted", data: { id: "user_alice", deleted: true } })).status).toBe(200);
  // Replays are harmless.
  expect((await post(t, { type: "user.deleted", data: { id: "user_alice", deleted: true } })).status).toBe(200);

  const state = await t.run(async (ctx) => ({
    alice: await ctx.db.get(w.alice.id),
    tool: await ctx.db.get(w.toolId),
    pending: await ctx.db.get(ownersPending),
    active: await ctx.db.get(active),
  }));
  expect(state.alice).toMatchObject({ name: "Former neighbour", email: null, deletedAt: expect.any(Number) });
  expect(state.tool?.status).toBe("removed");
  expect(state.pending).toMatchObject({ status: "cancelled", closeReason: "listing_removed" });
  expect(state.active?.status).toBe("active");

  // A late user.updated must not resurrect the data.
  await post(t, {
    type: "user.updated",
    data: { id: "user_alice", first_name: "Alice", last_name: "M", primary_email_address_id: null, email_addresses: [] },
  });
  expect((await t.run((ctx) => ctx.db.get(w.alice.id)))?.name).toBe("Former neighbour");
});

test("deleting a borrower cancels their open requests and tells the owner", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w, { status: "approved" });
  await post(t, { type: "user.deleted", data: { id: "user_bob", deleted: true } });
  const state = await t.run(async (ctx) => ({
    loan: await ctx.db.get(loanId),
    events: await ctx.db.query("outboxEvents").collect(),
  }));
  expect(state.loan).toMatchObject({ status: "cancelled", closeReason: "account_deleted" });
  expect(state.events.map((e) => [e.type, e.recipientId])).toEqual([["loan.cancelled", w.alice.id]]);
});
