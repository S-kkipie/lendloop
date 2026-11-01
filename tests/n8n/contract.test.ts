// Runs the Code nodes' jsCode from the exported workflows against the wire
// contract: the shared HMAC vectors, Convex's own sign/verifySignature, and the
// Convex validators for every write-back body. The Crypto node is emulated with
// node:crypto (HMAC-SHA256 hex over the `canonical` field).
import { validate } from "convex-helpers/validators";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SIGNATURE_WINDOW_SECONDS,
  vAutomationError,
  vNotificationStatus,
  vReminderReport,
} from "../../convex/automation/contract";
import { sign, verifySignature } from "../../convex/lib/hmac";
import { EVENT_TYPES } from "../../convex/lib/validators";

type Json = Record<string, unknown>;
type Item = { json: Json };
type Workflow = { nodes: { name: string; parameters: { jsCode?: string } }[] };

const vectors = JSON.parse(readFileSync(new URL("../../contracts/hmac-vectors.json", import.meta.url), "utf8")) as {
  secret: string;
  cases: { name: string; timestamp: string; method: string; path: string; body: string; signature: string }[];
};
const SECRET = vectors.secret;
const WEBHOOK_PATH = "/webhook/lendloop-loan-events";

function codeOf(file: string, node: string): string {
  const workflow = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../n8n/workflows/${file}`, import.meta.url)), "utf8"),
  ) as Workflow;
  const code = workflow.nodes.find((n) => n.name === node)?.parameters.jsCode;
  if (!code) throw new Error(`${file}: no Code node named ${node}`);
  return code;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (this: unknown, ...args: unknown[]) => Promise<Item[]>;

// The subset of the n8n Code node API ("Run Once for All Items") the nodes use.
async function run(
  code: string,
  options: { input: Item[]; nodes?: Record<string, Item[]>; rawBody?: string; workflowName?: string },
): Promise<Json[]> {
  const { input, nodes = {}, rawBody, workflowName = "loan-notifications" } = options;
  const $input = { first: () => input[0], all: () => input };
  const $ = (name: string) => {
    const items = nodes[name];
    if (!items) throw new Error(`node ${name} not provided`);
    return { first: () => items[0], all: () => items };
  };
  const helpers = {
    getBinaryDataBuffer: async (index: number, property: string) => {
      if (rawBody === undefined || index !== 0 || property !== "data") throw new Error("no binary data");
      return Buffer.from(rawBody, "utf8");
    },
  };
  const fn = new AsyncFunction("$input", "$", "$execution", "$workflow", "Buffer", code);
  const out = await fn.call({ helpers }, $input, $, { id: "4242" }, { name: workflowName }, Buffer);
  return out.map((item) => item.json);
}

const hmacHex = (secret: string, value: string) => createHmac("sha256", secret).update(value, "utf8").digest("hex");

const BUILD = codeOf("loan-notifications.json", "Build canonical string");
const VERIFY = codeOf("loan-notifications.json", "Verify signature");

// Webhook item -> Build canonical string -> Compute HMAC and Compute previous
// HMAC (both Crypto nodes emulated) -> Verify signature. `secret` is n8n's
// current secret; `previous` its previous one, which the entrypoint sets to the
// current secret when no rotation is in progress.
async function inbound(
  request: { headers: Record<string, string>; body?: string },
  secret = SECRET,
  previous = secret,
) {
  const [built] = await run(BUILD, { input: [{ json: { headers: request.headers } }], rawBody: request.body });
  const canonical = String(built.canonical);
  const withHmac = { ...built, expected: hmacHex(secret, canonical), expectedPrevious: hmacHex(previous, canonical) };
  const [verdict] = await run(VERIFY, { input: [{ json: withHmac }] });
  return { built, verdict };
}

function setNow(seconds: number) {
  vi.setSystemTime(seconds * 1000);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("loan-notifications: inbound verification", () => {
  const webhookVectors = vectors.cases.filter((c) => c.path === WEBHOOK_PATH);

  test("the shared vectors include the webhook path", () => {
    expect(webhookVectors.length).toBeGreaterThan(0);
  });

  test.each(webhookVectors)("$name: canonical string and HMAC match the shared vector", async (vector) => {
    setNow(Number(vector.timestamp) + 5);
    const { built, verdict } = await inbound({
      headers: { "x-lendloop-timestamp": vector.timestamp, "x-lendloop-signature": `v1=${vector.signature}` },
      body: vector.body,
    });
    expect(built.canonical).toBe(`${vector.timestamp}.POST.${WEBHOOK_PATH}.${vector.body}`);
    expect(built.provided).toEqual([vector.signature]);
    expect(hmacHex(SECRET, String(built.canonical))).toBe(vector.signature);
    // Signature and window pass; the vector body is not an event (no eventId).
    expect(verdict).toEqual({ valid: false, reason: "malformed" });
  });

  describe("an event signed by Convex's own sign()", () => {
    const ts = webhookVectors[0].timestamp;
    const eventId = "evt_contract_1";
    const body = JSON.stringify({
      schemaVersion: 1,
      eventId,
      type: "loan.requested",
      tool: { name: "Taladro ñandú" },
    });
    let signature = "";
    const headers = () => ({
      "x-lendloop-timestamp": ts,
      "x-lendloop-signature": `v1=${signature}`,
      "x-lendloop-event-id": eventId,
    });

    beforeEach(async () => {
      signature = await sign(SECRET, ts, "POST", WEBHOOK_PATH, body);
      setNow(Number(ts) + 1);
    });

    test("is valid and yields the signed event ID and payload", async () => {
      const { verdict } = await inbound({ headers: headers(), body });
      expect(verdict).toEqual({ valid: true, eventId, payload: JSON.parse(body) });
    });

    test("is valid when one of several v1= values matches (rotation)", async () => {
      const { verdict } = await inbound({
        headers: { ...headers(), "x-lendloop-signature": `v1=${"0".repeat(64)}, v1=${signature}` },
        body,
      });
      expect(verdict.valid).toBe(true);
    });

    describe("during a rotation (n8n holds a new current secret and the old one as previous)", () => {
      const NEW_SECRET = "rotated-secret-0123456789abcdef0123456789abcdef";

      test("an event Convex still signs with the previous secret is valid", async () => {
        const { verdict } = await inbound({ headers: headers(), body }, NEW_SECRET, SECRET);
        expect(verdict).toEqual({ valid: true, eventId, payload: JSON.parse(body) });
      });

      test("an event signed with the new current secret is valid", async () => {
        signature = await sign(NEW_SECRET, ts, "POST", WEBHOOK_PATH, body);
        const { verdict } = await inbound({ headers: headers(), body }, NEW_SECRET, SECRET);
        expect(verdict.valid).toBe(true);
      });

      test("an event signed with neither secret is rejected", async () => {
        const { verdict } = await inbound(
          { headers: headers(), body },
          NEW_SECRET,
          "older-secret-0123456789abcdef0123456789abcdef",
        );
        expect(verdict).toEqual({ valid: false, reason: "mismatch" });
      });

      test("the previous secret still needs a fresh timestamp", async () => {
        setNow(Number(ts) + SIGNATURE_WINDOW_SECONDS + 1);
        const { verdict } = await inbound({ headers: headers(), body }, NEW_SECRET, SECRET);
        expect(verdict).toEqual({ valid: false, reason: "stale" });
      });
    });

    test("is valid exactly at the edge of the window", async () => {
      setNow(Number(ts) + SIGNATURE_WINDOW_SECONDS);
      expect((await inbound({ headers: headers(), body })).verdict.valid).toBe(true);
    });

    test.each([
      ["tampered body", { body: body.replace("ñandú", "nandu") }, "mismatch"],
      ["wrong signature", { signature: "f".repeat(64) }, "mismatch"],
      ["signed with another secret", { secret: "another-secret-0123456789abcdef0123456789" }, "mismatch"],
      ["missing signature header", { drop: "x-lendloop-signature" }, "missing"],
      ["missing timestamp header", { drop: "x-lendloop-timestamp" }, "missing"],
      ["signature without v1= prefix", { rawSignature: true }, "missing"],
      ["timestamp 301 s old", { age: SIGNATURE_WINDOW_SECONDS + 1 }, "stale"],
      ["event-id header differs from the signed body", { eventIdHeader: "evt_other" }, "malformed"],
      ["no body", { noBody: true }, "mismatch"],
    ] as const)("rejects: %s", async (_label, change: Record<string, unknown>, reason) => {
      if (change.age) setNow(Number(ts) + Number(change.age));
      const h: Record<string, string> = headers();
      if (change.signature) h["x-lendloop-signature"] = `v1=${String(change.signature)}`;
      if (change.rawSignature) h["x-lendloop-signature"] = signature;
      if (change.eventIdHeader) h["x-lendloop-event-id"] = String(change.eventIdHeader);
      if (change.drop) delete h[String(change.drop)];
      const sent = change.noBody ? undefined : String(change.body ?? body);
      const { verdict } = await inbound({ headers: h, body: sent }, change.secret ? String(change.secret) : SECRET);
      expect(verdict).toEqual({ valid: false, reason });
    });
  });
});

// Every n8n -> Convex body must pass the Convex validator, and its signature
// must pass Convex's verifySignature for the same method and path.
async function expectAcceptedByConvex(prepared: Json, method: "GET" | "POST", path: string) {
  const body = method === "GET" ? "" : String(prepared.body);
  expect(prepared.canonical).toBe(`${String(prepared.ts)}.${method}.${path}.${body}`);
  const verdict = await verifySignature({
    secrets: [SECRET],
    timestamp: String(prepared.ts),
    signatureHeader: `v1=${hmacHex(SECRET, String(prepared.canonical))}`,
    method,
    path,
    body,
  });
  expect(verdict).toEqual({ ok: true });
}

describe("write-backs are accepted by Convex", () => {
  beforeEach(() => setNow(1_793_620_900));

  test("Prepare status write-back: POST /n8n/notifications/status", async () => {
    const [prepared] = await run(codeOf("loan-notifications.json", "Prepare status write-back"), {
      input: [{ json: { accepted: ["test@example.com"] } }],
      nodes: { "Compose email": [{ json: { eventId: "evt_1" } }] },
    });
    const body = JSON.parse(String(prepared.body));
    expect(body).toEqual({ eventId: "evt_1", status: "sent", executionId: "4242" });
    expect(validate(vNotificationStatus, body)).toBe(true);
    await expectAcceptedByConvex(prepared, "POST", "/n8n/notifications/status");
  });

  test("Prepare failure report: POST /n8n/automation-errors with the event ID, no emails", async () => {
    const [prepared] = await run(codeOf("loan-notifications.json", "Prepare failure report"), {
      input: [{ json: { error: "Mailbox unavailable for <ana@example.com>" } }],
      nodes: { "Compose email": [{ json: { eventId: "evt_1" } }] },
    });
    const body = JSON.parse(String(prepared.body));
    expect(body).toMatchObject({ workflow: "loan-notifications", executionId: "4242", node: "Send email", eventId: "evt_1" });
    expect(body.message).toBe("Mailbox unavailable for <[email]>");
    expect(validate(vAutomationError, body)).toBe(true);
    await expectAcceptedByConvex(prepared, "POST", "/n8n/automation-errors");
  });

  test("Prepare failure report: an HTTP error keeps the mail API's reason from its description", async () => {
    const [prepared] = await run(codeOf("loan-notifications.json", "Prepare failure report"), {
      input: [
        {
          json: {
            error: {
              message: "Bad gateway - the service failed to handle your request",
              description: '{"name":"smtp_error","message":"SMTP 451 4.7.1 <ana@example.com> try later"}',
            },
          },
        },
      ],
      nodes: { "Compose email": [{ json: { eventId: "evt_1" } }] },
    });
    const { message } = JSON.parse(String(prepared.body));
    expect(message).toContain("Bad gateway");
    expect(message).toContain("SMTP 451");
    expect(message).not.toMatch(/ana@example\.com/);
  });

  test("Prepare overdue request: signed GET /n8n/overdue-loans matches the shared vector", async () => {
    const vector = vectors.cases.find((c) => c.method === "GET" && c.path === "/n8n/overdue-loans")!;
    setNow(Number(vector.timestamp));
    const [prepared] = await run(codeOf("overdue-reminders.json", "Prepare overdue request"), {
      input: [{ json: {} }],
    });
    expect(prepared.ts).toBe(vector.timestamp);
    expect(prepared.canonical).toBe(`${vector.timestamp}.GET./n8n/overdue-loans.`);
    expect(hmacHex(SECRET, String(prepared.canonical))).toBe(vector.signature);
    await expectAcceptedByConvex(prepared, "GET", "/n8n/overdue-loans");
  });

  test("Prepare reminder write-back: POST /n8n/reminders per loan", async () => {
    const prepared = await run(codeOf("overdue-reminders.json", "Prepare reminder write-back"), {
      input: [
        { json: { loanId: "k1", idempotencyKey: "k1:2026-11-01", status: "sent" } },
        { json: { loanId: "k2", idempotencyKey: "k2:2026-11-01", status: "failed", error: "SMTP down" } },
      ],
      workflowName: "overdue-reminders",
    });
    expect(prepared).toHaveLength(2);
    const bodies = prepared.map((p) => JSON.parse(String(p.body)));
    expect(bodies).toEqual([
      { loanId: "k1", idempotencyKey: "k1:2026-11-01", status: "sent", executionId: "4242" },
      { loanId: "k2", idempotencyKey: "k2:2026-11-01", status: "failed", executionId: "4242", error: "SMTP down" },
    ]);
    for (const [i, p] of prepared.entries()) {
      expect(validate(vReminderReport, bodies[i])).toBe(true);
      await expectAcceptedByConvex(p, "POST", "/n8n/reminders");
    }
  });

  test("Sanitize error: POST /n8n/automation-errors without emails, truncated", async () => {
    const code = codeOf("error-handler.json", "Sanitize error");
    const [prepared] = await run(code, {
      input: [
        {
          json: {
            execution: {
              id: "77",
              lastNodeExecuted: "Send email",
              error: { message: `Recipient ana@example.com rejected ${"x".repeat(600)}` },
            },
            workflow: { id: "llLoanNotify0001", name: "loan-notifications" },
          },
        },
      ],
      workflowName: "error-handler",
    });
    const body = JSON.parse(String(prepared.body));
    expect(body).toMatchObject({ workflow: "loan-notifications", executionId: "77", node: "Send email" });
    expect(body.message.startsWith("Recipient [email] rejected")).toBe(true);
    expect(body.message).toHaveLength(500);
    expect(body).not.toHaveProperty("eventId");
    expect(validate(vAutomationError, body)).toBe(true);
    expect(prepared).toMatchObject({ workflow: "loan-notifications", node: "Send email", executionId: "77" });
    await expectAcceptedByConvex(prepared, "POST", "/n8n/automation-errors");

    // A trigger failure has no execution: a synthetic ID keeps Convex's dedupe working.
    const [fromTrigger] = await run(code, {
      input: [{ json: { trigger: { error: { message: "boom" } }, workflow: { id: "llOverdueRemind01", name: "overdue-reminders" } } }],
    });
    const triggerBody = JSON.parse(String(fromTrigger.body));
    expect(triggerBody.executionId).toMatch(/^trigger-llOverdueRemind01-\d+$/);
    expect(validate(vAutomationError, triggerBody)).toBe(true);
  });
});

describe("email copy", () => {
  const COMPOSE = codeOf("loan-notifications.json", "Compose email");
  const payload = (type: string, overrides: Json = {}) => ({
    eventId: "evt_1",
    payload: {
      schemaVersion: 1,
      eventId: "evt_1",
      type,
      occurredAt: "2026-11-06T11:02:00Z",
      recipient: { email: "ana@example.com", firstName: "Ana" },
      tool: { name: "Cordless drill" },
      loan: { id: "k1", status: "approved", startDate: "2026-11-08", endDate: "2026-11-12" },
      counterpartFirstName: "Marta",
      actionUrl: "http://localhost:3000/loans/k1",
      ...overrides,
    },
  });
  const SUBJECTS: Record<string, string> = {
    "loan.requested": "Marta wants to borrow your Cordless drill",
    "loan.approved": "Your request for the Cordless drill was approved",
    "loan.declined": "Your request for the Cordless drill was declined",
    "loan.cancelled": "A booking for the Cordless drill was cancelled",
    "loan.handed_over": "You have the Cordless drill until 2026-11-12",
    "loan.returned": "The Cordless drill was returned",
    "loan.expired": "A request for the Cordless drill expired",
    "listing.removed": "Your listing changed: Cordless drill",
  };

  test("covers exactly the Convex event types", () => {
    expect(Object.keys(SUBJECTS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  test.each([...EVENT_TYPES])("%s: subject, first-name greeting, dates, link, sign-off", async (type) => {
    const [email] = await run(COMPOSE, { input: [{ json: payload(type) }] });
    expect(email).toMatchObject({ eventId: "evt_1", to: "ana@example.com", subject: SUBJECTS[type] });
    const text = String(email.text);
    expect(text.startsWith("Hi Ana,\n")).toBe(true);
    expect(text).toContain("Dates: 2026-11-08 to 2026-11-12");
    expect(text).toContain("http://localhost:3000/loans/k1");
    expect(text.endsWith("\nLendLoop")).toBe(true);
    expect(`${String(email.subject)}\n${text}`).not.toMatch(/[–—]|@/);
  });

  test("works without a loan or a counterpart", async () => {
    const [email] = await run(COMPOSE, {
      input: [{ json: payload("loan.requested", { loan: null, counterpartFirstName: null }) }],
    });
    expect(email.subject).toBe("A neighbour wants to borrow your Cordless drill");
    expect(String(email.text)).not.toContain("Dates:");
  });

  test("an unknown event type fails loudly (error workflow), never sends a blank email", async () => {
    await expect(run(COMPOSE, { input: [{ json: payload("loan.unknown") }] })).rejects.toThrow(/Unsupported event type/);
  });

  test("overdue reminder copy", async () => {
    const loan = (daysOverdue: number) => ({
      json: {
        loanId: "k1",
        idempotencyKey: "k1:2026-10-31",
        borrower: { email: "joaquin@example.com", firstName: "Joaquín" },
        tool: { name: "Ladder" },
        endDate: "2026-10-28",
        daysOverdue,
      },
    });
    const [three, one] = await run(codeOf("overdue-reminders.json", "Compose reminder"), {
      input: [loan(3), loan(1)],
    });
    expect(three).toMatchObject({
      loanId: "k1",
      idempotencyKey: "k1:2026-10-31",
      to: "joaquin@example.com",
      subject: "Reminder: please return the Ladder",
    });
    expect(String(three.text)).toContain("It was due on 2026-10-28, 3 days ago.");
    expect(String(one.text)).toContain("1 day ago.");
    expect(String(three.text).startsWith("Hi Joaquín,\n")).toBe(true);
    expect(String(three.text)).not.toMatch(/[–—]|@/);
  });
});
