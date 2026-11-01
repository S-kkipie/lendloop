import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./automation/contract";
import { sign, signatureHeader } from "./lib/hmac";
import { NOW, insertLoan, seedWorld, setupTest, type TestT } from "./test.helpers";

const SECRET = "convex-inbound-secret-0123456789abcdef";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // today 2026-11-02
  vi.stubEnv("CONVEX_INBOUND_SECRET", SECRET);
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function signedFetch(t: TestT, method: "GET" | "POST", path: string, body?: unknown, secret = SECRET) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: signatureHeader(await sign(secret, ts, method, path, raw)),
  };
  if (method === "POST") headers["content-type"] = "application/json";
  return await t.fetch(path, { method, headers, body: method === "POST" ? raw : undefined });
}

test("health needs no signature and returns no data", async () => {
  const t = setupTest();
  const res = await t.fetch("/health", { method: "GET" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

describe("signature enforcement", () => {
  test("unsigned, wrong-secret and stale requests get a bare 401", async () => {
    const t = setupTest();
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);
    const wrong = await signedFetch(t, "GET", "/n8n/overdue-loans", undefined, "x".repeat(40));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "unauthorized" });

    const ts = String(Math.floor(NOW / 1000) - 600);
    const stale = await t.fetch("/n8n/overdue-loans", {
      method: "GET",
      headers: {
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: signatureHeader(await sign(SECRET, ts, "GET", "/n8n/overdue-loans", "")),
      },
    });
    expect(stale.status).toBe(401);
  });

  test("a signature for one path can't be replayed on another", async () => {
    const t = setupTest();
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ workflow: "w", executionId: "1", message: "m" });
    const res = await t.fetch("/n8n/automation-errors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: signatureHeader(await sign(SECRET, ts, "POST", "/n8n/reminders", body)),
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  test("unsigned junk never drains the shared rate-limit bucket", async () => {
    const t = setupTest();
    // 300 unsigned requests: more than the bucket's capacity (240).
    for (let i = 0; i < 300; i++) {
      const res = await t.fetch("/n8n/automation-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow: "w", executionId: String(i), message: "junk" }),
      });
      expect(res.status).toBe(401);
    }
    const signed = await signedFetch(t, "POST", "/n8n/automation-errors", { workflow: "w", executionId: "real", message: "m" });
    expect(signed.status).toBe(200);
  });

  test("signed requests beyond the bucket get 429", async () => {
    const t = setupTest();
    const statuses = new Set<number>();
    for (let i = 0; i < 245; i++) statuses.add((await signedFetch(t, "GET", "/n8n/overdue-loans")).status);
    expect([...statuses].sort()).toEqual([200, 429]);
  });

  test("not configured → 503; wrong content type → 415; oversize → 413; bad body → 400", async () => {
    const t = setupTest();
    vi.stubEnv("CONVEX_INBOUND_SECRET", "");
    expect((await signedFetch(t, "GET", "/n8n/overdue-loans")).status).toBe(503);
    vi.stubEnv("CONVEX_INBOUND_SECRET", SECRET);

    const text = await t.fetch("/n8n/reminders", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    expect(text.status).toBe(415);
    const big = await signedFetch(t, "POST", "/n8n/automation-errors", {
      workflow: "w",
      executionId: "1",
      message: "x".repeat(70_000),
    });
    expect(big.status).toBe(413);
    const bad = await signedFetch(t, "POST", "/n8n/reminders", { loanId: 1 });
    expect(bad.status).toBe(400);
  });
});

describe("overdue reminders", () => {
  test("lists overdue loans with minimal fields and records a heartbeat", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active", startDate: "2026-10-25", endDate: "2026-10-30" });
    await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-11-01", endDate: "2026-11-04" });

    const res = await signedFetch(t, "GET", "/n8n/overdue-loans");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      loans: [
        {
          loanId,
          idempotencyKey: `${loanId}:2026-11-02`,
          borrower: { email: "bob@example.com", firstName: "Bob" },
          tool: { name: "Cordless drill" },
          endDate: "2026-10-30",
          daysOverdue: 3,
        },
      ],
    });
    const beats = await t.run((ctx) => ctx.db.query("automationHeartbeats").collect());
    expect(beats).toHaveLength(1);
  });

  test("write-back is idempotent and only upgrades failed → sent", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active", startDate: "2026-10-25", endDate: "2026-10-30" });
    const key = `${loanId}:2026-11-02`;
    const report = { loanId, idempotencyKey: key, executionId: "exec-1" };
    const post = async (extra: Record<string, unknown>) =>
      (await signedFetch(t, "POST", "/n8n/reminders", { ...report, ...extra })).json();

    expect(await post({ status: "failed", error: "SMTP down for bob@example.com" })).toMatchObject({ duplicate: false });
    expect(await post({ status: "sent" })).toMatchObject({ duplicate: false });
    expect(await post({ status: "sent" })).toMatchObject({ duplicate: true });
    expect(await post({ status: "failed" })).toMatchObject({ duplicate: true });

    const reminders = await t.run((ctx) => ctx.db.query("reminders").collect());
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ status: "sent", idempotencyKey: key });

    // Already reminded today: not listed again.
    expect(await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json()).toEqual({ loans: [] });
  });

  test("rejects keys that are not today's key for that loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active", startDate: "2026-10-25", endDate: "2026-10-30" });
    const res = await signedFetch(t, "POST", "/n8n/reminders", {
      loanId,
      idempotencyKey: `${loanId}:2026-11-01`,
      status: "sent",
      executionId: "exec-1",
    });
    expect(res.status).toBe(422);
  });
});

describe("notification status and errors", () => {
  test("n8n can mark an event sent; errors mark it failed and are deduplicated", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w);
    const [sentId, failedId] = await t.run(async (ctx) => [
      await ctx.db.insert("outboxEvents", {
        type: "loan.requested",
        schemaVersion: 1,
        recipientId: w.alice.id,
        loanId,
        status: "pending",
        attempts: 1,
      }),
      await ctx.db.insert("outboxEvents", {
        type: "loan.requested",
        schemaVersion: 1,
        recipientId: w.alice.id,
        loanId,
        status: "delivered",
        attempts: 1,
      }),
    ]);

    const sent = await signedFetch(t, "POST", "/n8n/notifications/status", {
      eventId: sentId,
      status: "sent",
      executionId: "e1",
    });
    expect(await sent.json()).toMatchObject({ updated: true });

    const error = {
      workflow: "loan-notifications",
      executionId: "e2",
      node: "Send Email",
      message: "550 rejected for alice@example.com",
      eventId: failedId,
    };
    expect(await (await signedFetch(t, "POST", "/n8n/automation-errors", error)).json()).toEqual({ duplicate: false });
    expect(await (await signedFetch(t, "POST", "/n8n/automation-errors", error)).json()).toEqual({ duplicate: true });

    const state = await t.run(async (ctx) => ({
      sent: await ctx.db.get(sentId),
      failed: await ctx.db.get(failedId),
      errors: await ctx.db.query("automationErrors").collect(),
    }));
    expect(state.sent?.status).toBe("sent");
    expect(state.failed).toMatchObject({ status: "failed", lastError: "550 rejected for [email]" });
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].message).not.toContain("alice@");

    const unknown = await signedFetch(t, "POST", "/n8n/notifications/status", {
      eventId: "nope",
      status: "sent",
      executionId: "e3",
    });
    expect(unknown.status).toBe(404);
  });
});
