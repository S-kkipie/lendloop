import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { verifySignature } from "../lib/hmac";
import { NOW, seedWorld, setupTest } from "../test.helpers";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";

const SECRET = "n8n-webhook-secret-0123456789abcdef0123";
const URL_ = "http://n8n.test/webhook/lendloop-loan-events";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("N8N_WEBHOOK_URL", URL_);
  vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("APP_URL", "https://lendloop.test");
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function requestLoan() {
  const t = setupTest();
  const w = await seedWorld(t);
  await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-05", endDate: "2026-11-07" });
  return { t, w };
}
const events = (t: ReturnType<typeof setupTest>) => t.run((ctx) => ctx.db.query("outboxEvents").collect());

test("delivers a signed payload and marks the event delivered", async () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  const { t, w } = await requestLoan();
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [event] = await events(t);
  expect(event).toMatchObject({ status: "delivered", attempts: 1, type: "loan.requested", recipientId: w.alice.id });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const [url, init] = fetchMock.mock.calls[0];
  const headers = init.headers as Record<string, string>;
  expect(url).toBe(URL_);
  expect(headers[EVENT_ID_HEADER]).toBe(event._id);
  const verdict = await verifySignature({
    secrets: [SECRET],
    timestamp: headers[TIMESTAMP_HEADER],
    signatureHeader: headers[SIGNATURE_HEADER],
    method: "POST",
    path: "/webhook/lendloop-loan-events",
    body: init.body as string,
    nowMs: Number(headers[TIMESTAMP_HEADER]) * 1000,
  });
  expect(verdict).toEqual({ ok: true });
  expect(JSON.parse(init.body as string)).toMatchObject({
    recipient: { email: "alice@example.com", firstName: "Alice" },
  });
});

test("retries with backoff on 503, then gives up after 5 attempts", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  const { t } = await requestLoan();
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [event] = await events(t);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  expect(event).toMatchObject({ status: "dead", attempts: 5, lastError: "n8n responded 503" });
});

test("network errors are retried and can recover", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { t } = await requestLoan();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [event] = await events(t);
  expect(event).toMatchObject({ status: "delivered", attempts: 2 });
});

test("a 401 (bad signature or config) goes straight to dead", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  const { t } = await requestLoan();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [event] = await events(t);
  expect(event).toMatchObject({ status: "dead", attempts: 1 });
});

test("missing configuration marks the event dead without calling n8n", async () => {
  vi.stubEnv("N8N_WEBHOOK_SECRET", "too-short");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { t } = await requestLoan();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [event] = await events(t);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(event.status).toBe("dead");
  expect(event.lastError).toContain("N8N_WEBHOOK_SECRET");
});

test("events for deleted recipients are skipped", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { t, w } = await requestLoan();
  await t.run((ctx) => ctx.db.patch(w.alice.id, { deletedAt: Date.now() }));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [event] = await events(t);
  expect(event.status).toBe("skipped");
  expect(fetchMock).not.toHaveBeenCalled();
});
