# LendLoop Plan 2a: Automation (Convex side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything Convex needs for the n8n integration: HMAC signing/verification with shared test vectors, a redacting logger, the versioned payload contract, outbox delivery with retries and dead letters, signed inbound HTTP endpoints (overdue loans, reminder write-back, notification status, automation errors, health), a Svix-verified Clerk webhook with account deletion, and admin automation-health tools.

**Architecture:** Pure logic (`convex/model/delivery.ts`, `convex/model/heartbeat.ts`, `convex/lib/hmac.ts`, `convex/lib/logger.ts`) is unit-tested. `enqueueEvent` now schedules `internal.automation.delivery.deliver`, an action that claims the event, builds the payload at send time, signs it and POSTs to n8n, then records the outcome through internal mutations. Inbound n8n endpoints share one `signedEndpoint` wrapper (rate limit → size/content-type checks → HMAC verify → JSON parse → validator) so no endpoint can skip a check.

**Tech Stack:** Convex httpActions + scheduler, Web Crypto (`crypto.subtle`), `svix` 2.9, `@convex-dev/rate-limiter`, `convex-helpers/validators` (`validate`), Vitest + convex-test (`t.fetch`, `finishAllScheduledFunctions`).

**Spec:** `docs/superpowers/specs/2026-10-31-lendloop-design.md` §7.1–7.6, §7.9 (Clerk webhook), §8 (secrets, logging), §4 (account deletion).

**Depends on:** Plan 1 (merged on `main`).

## Global Constraints

- Signature headers (lower-case): `x-lendloop-timestamp` (unix seconds, 10 digits), `x-lendloop-signature` (`v1=<64 hex>`; several comma-separated values allowed), `x-lendloop-event-id` (Convex → n8n only).
- Canonical string: `` `${timestamp}.${METHOD}.${path}.${rawBody}` `` (GET body is the empty string). HMAC-SHA256, lower-case hex.
- Window: |now − timestamp| ≤ 300 s. Verify with `crypto.subtle.verify`. Verifiers accept `SECRET` and `SECRET_PREVIOUS`; signers use the current secret only. Secrets shorter than 32 characters are ignored/rejected.
- Separate secrets per direction: `N8N_WEBHOOK_SECRET[_PREVIOUS]` (Convex → n8n), `CONVEX_INBOUND_SECRET[_PREVIOUS]` (n8n → Convex).
- Inbound bodies ≤ 64 KB (413), POST requires `content-type: application/json` (415), bad signature → 401 `{"error":"unauthorized"}`, invalid body → 400 `{"error":"invalid_body"}`, unconfigured secrets → 503. No error response includes details.
- Backoff: 30 s, 2 min, 10 min, 1 h, 6 h; 5 attempts then `dead`. 2xx → delivered; 408/429/5xx/network/timeout → retry; other 4xx → dead immediately. Request timeout 10 s.
- `markDelivered` never downgrades `sent`, `failed`, `dead` or `skipped`.
- Payload v1 keys are exactly: `schemaVersion, eventId, type, occurredAt, recipient{email, firstName}, tool{name}, loan{id, status, startDate, endDate} | null, counterpartFirstName, actionUrl`.
- Logs are JSON lines through `convex/lib/logger.ts`; keys `email`, `name`, `firstName`, `message`, `recipient`, `body` are redacted and email-shaped strings are masked.
- All Plan 1 global constraints still apply (wrappers only, error codes, IDs-only outbox/audit, commit trailer).

---

## File map

```
contracts/hmac-vectors.json            shared signing vectors (generated with node:crypto)
convex/automation/contract.ts          header names, limits, payload/report types + validators
convex/automation/outbox.ts            (modify) schedule delivery; optional replayOf
convex/automation/delivery.ts          deliver action + claim/markDelivered/scheduleRetry/markDead/markSkipped/payloadFor
convex/automation/payloads.ts          buildNotificationPayload
convex/automation/inbound.ts           signedEndpoint wrapper + json() helper
convex/automation/reminders.ts         overdueLoans query, recordReminder mutation
convex/automation/heartbeat.ts         checkIn, checkStale (cron)
convex/automation/notifications.ts     recordNotificationStatus mutation
convex/automation/errors.ts            recordError mutation
convex/http.ts                         router
convex/clerkWebhook.ts                 Svix-verified Clerk webhook httpAction
convex/users.ts                        (modify) applyClerkUpdate, deleteAccount internal mutations
convex/lib/hmac.ts                     sign/verify
convex/lib/logger.ts                   redact, sanitizeError, log
convex/lib/integrationConfig.ts        env access for URLs and secrets
convex/lib/rateLimits.ts               (modify) inboundHttp, clerkWebhook limits
convex/lib/tools.ts                    (modify) removeToolCascade accepts actorType "system"
convex/model/delivery.ts               classifyStatus, nextRetryDelay, constants
convex/model/heartbeat.ts              isStale
convex/admin.ts                        (modify) automationHealth, replayEvent, resolveError
convex/crons.ts                        (modify) heartbeat check
tests/authz/matrix.ts, convex/authz.test.ts   (modify) 3 new admin rows
tests: convex/lib/hmac.test.ts, convex/lib/logger.test.ts, convex/model/delivery.test.ts,
       convex/model/heartbeat.test.ts, convex/automation/payloads.test.ts,
       convex/automation/delivery.test.ts, convex/http.test.ts, convex/clerkWebhook.test.ts,
       convex/admin.automation.test.ts
```

---

### Task 1: HMAC signing with shared vectors

**Files:**
- Create: `contracts/hmac-vectors.json`, `convex/lib/hmac.ts`, `convex/automation/contract.ts`
- Test: `convex/lib/hmac.test.ts`

**Interfaces:**
- Produces:
  - `contract.ts`: `TIMESTAMP_HEADER = "x-lendloop-timestamp"`, `SIGNATURE_HEADER = "x-lendloop-signature"`, `EVENT_ID_HEADER = "x-lendloop-event-id"`, `SIGNATURE_WINDOW_SECONDS = 300`, `MAX_BODY_BYTES = 65536`, `MIN_SECRET_LENGTH = 32` (types and validators added in Tasks 3 and 5).
  - `hmac.ts`: `canonicalString(timestamp: string, method: string, path: string, body: string): string`, `sign(secret: string, timestamp: string, method: string, path: string, body: string): Promise<string>` (hex), `signatureHeader(hex: string): string` (`v1=<hex>`), `parseSignatureHeader(header: string | null): string[]`, `type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" }`, `verifySignature(input: { secrets: string[]; timestamp: string | null; signatureHeader: string | null; method: string; path: string; body: string; nowMs?: number; windowSeconds?: number }): Promise<VerifyResult>`

- [ ] **Step 1: Generate vectors with an independent implementation (node:crypto)**

```bash
mkdir -p contracts
node -e '
const { createHmac } = require("node:crypto");
const secret = "lendloop-test-secret-0123456789abcdef0123456789";
const cases = [
  { name: "POST reminder write-back", timestamp: "1793620800", method: "POST", path: "/n8n/reminders", body: "{\"loanId\":\"k17abc\",\"status\":\"sent\"}" },
  { name: "GET overdue loans (empty body)", timestamp: "1793620801", method: "GET", path: "/n8n/overdue-loans", body: "" },
  { name: "Unicode body", timestamp: "1793620802", method: "POST", path: "/webhook/lendloop-loan-events", body: "{\"tool\":{\"name\":\"Taladro ñandú\"}}" },
];
for (const c of cases) {
  c.signature = createHmac("sha256", secret).update(`${c.timestamp}.${c.method}.${c.path}.${c.body}`, "utf8").digest("hex");
}
process.stdout.write(JSON.stringify({ secret, cases }, null, 2) + "\n");
' > contracts/hmac-vectors.json
```

Expected: `contracts/hmac-vectors.json` with 3 cases, each with a 64-char hex `signature`.

- [ ] **Step 2: Write `convex/automation/contract.ts` (constants only for now)**

```ts
// Wire contract between Convex and n8n. Changing anything here is a breaking
// change for the exported n8n workflows; bump schemaVersion if payloads change.
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const EVENT_ID_HEADER = "x-lendloop-event-id";
export const SIGNATURE_WINDOW_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;
export const MIN_SECRET_LENGTH = 32;
```

- [ ] **Step 3: Write failing tests**

`convex/lib/hmac.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import vectors from "../../contracts/hmac-vectors.json";
import { canonicalString, parseSignatureHeader, sign, signatureHeader, verifySignature } from "./hmac";

const { secret, cases } = vectors;

describe("shared vectors (generated with node:crypto)", () => {
  test.each(cases)("$name", async (c) => {
    expect(await sign(secret, c.timestamp, c.method, c.path, c.body)).toBe(c.signature);
  });
});

test("canonical string binds timestamp, method and path", () => {
  expect(canonicalString("1", "post", "/x", "{}")).toBe("1.POST./x.{}");
});

test("parseSignatureHeader keeps only well-formed v1 values", () => {
  const good = "a".repeat(64);
  expect(parseSignatureHeader(`v1=${good}, v0=${good}, v1=zz`)).toEqual([good]);
  expect(parseSignatureHeader(null)).toEqual([]);
});

describe("verifySignature", () => {
  const c = cases[0];
  const nowMs = Number(c.timestamp) * 1000;
  const base = {
    secrets: [secret],
    timestamp: c.timestamp,
    signatureHeader: signatureHeader(c.signature),
    method: c.method,
    path: c.path,
    body: c.body,
    nowMs,
  };

  test("accepts a valid signature", async () => {
    expect(await verifySignature(base)).toEqual({ ok: true });
  });

  test("accepts the previous secret during rotation", async () => {
    expect(await verifySignature({ ...base, secrets: ["x".repeat(40), secret] })).toEqual({ ok: true });
  });

  test("rejects a tampered body, path or method", async () => {
    expect(await verifySignature({ ...base, body: c.body + " " })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifySignature({ ...base, path: "/n8n/other" })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifySignature({ ...base, method: "PUT" })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("rejects stale and future timestamps beyond 300 s", async () => {
    expect(await verifySignature({ ...base, nowMs: nowMs + 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, nowMs: nowMs - 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, nowMs: nowMs + 299_000 })).toEqual({ ok: true });
  });

  test("rejects missing headers and malformed timestamps", async () => {
    expect(await verifySignature({ ...base, signatureHeader: null })).toEqual({ ok: false, reason: "missing" });
    expect(await verifySignature({ ...base, timestamp: null })).toEqual({ ok: false, reason: "missing" });
    expect(await verifySignature({ ...base, timestamp: "17936208OO" })).toEqual({ ok: false, reason: "missing" });
  });

  test("rejects when no secret is configured", async () => {
    expect(await verifySignature({ ...base, secrets: [] })).toEqual({ ok: false, reason: "mismatch" });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm vitest run convex/lib/hmac.test.ts` → FAIL (module `./hmac` missing). If the JSON import fails to type-check later, add `"resolveJsonModule": true` to `convex/tsconfig.json`.

- [ ] **Step 5: Implement `convex/lib/hmac.ts`**

```ts
// HMAC-SHA256 request signing shared by both directions of the n8n integration.
import { SIGNATURE_WINDOW_SECONDS } from "../automation/contract";

const encoder = new TextEncoder();
const TIMESTAMP = /^\d{10}$/;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

export function canonicalString(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sign(secret: string, timestamp: string, method: string, path: string, body: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(canonicalString(timestamp, method, path, body)),
  );
  return toHex(signature);
}

export function signatureHeader(hex: string): string {
  return `v1=${hex}`;
}

export function parseSignatureHeader(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter((hex) => HEX_SIGNATURE.test(hex));
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export async function verifySignature(input: {
  secrets: string[];
  timestamp: string | null;
  signatureHeader: string | null;
  method: string;
  path: string;
  body: string;
  nowMs?: number;
  windowSeconds?: number;
}): Promise<VerifyResult> {
  const signatures = parseSignatureHeader(input.signatureHeader);
  if (!input.timestamp || !TIMESTAMP.test(input.timestamp) || signatures.length === 0) {
    return { ok: false, reason: "missing" };
  }
  const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - Number(input.timestamp)) > (input.windowSeconds ?? SIGNATURE_WINDOW_SECONDS)) {
    return { ok: false, reason: "stale" };
  }
  const data = encoder.encode(canonicalString(input.timestamp, input.method, input.path, input.body));
  for (const secret of input.secrets) {
    const key = await hmacKey(secret, "verify");
    for (const hex of signatures) {
      // crypto.subtle.verify compares in constant time.
      if (await crypto.subtle.verify("HMAC", key, fromHex(hex), data)) return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}
```

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `pnpm vitest run convex/lib/hmac.test.ts && pnpm typecheck`
Expected: PASS. (If `Uint8Array<ArrayBuffer>` is rejected by the installed TS lib, change the return type to `Uint8Array`.)

```bash
git add contracts convex/lib/hmac.ts convex/lib/hmac.test.ts convex/automation/contract.ts convex/tsconfig.json
git commit -m "feat(integration): add HMAC request signing with shared node:crypto vectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Redacting logger, delivery and heartbeat rules

**Files:**
- Create: `convex/lib/logger.ts`, `convex/model/delivery.ts`, `convex/model/heartbeat.ts`
- Test: `convex/lib/logger.test.ts`, `convex/model/delivery.test.ts`, `convex/model/heartbeat.test.ts`

**Interfaces:**
- Produces:
  - `logger.ts`: `redact(value: unknown): unknown`, `sanitizeError(text: string, max?: number): string` (default 300), `log.info|warn|error(event: string, fields?: Record<string, unknown>): void`
  - `model/delivery.ts`: `MAX_ATTEMPTS = 5`, `BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000]`, `REQUEST_TIMEOUT_MS = 10_000`, `CLAIM_LEASE_MS = 60_000`, `type DeliveryOutcome = "delivered" | "retry" | "dead"`, `classifyStatus(status: number): DeliveryOutcome`, `nextRetryDelay(attemptsMade: number): number | null`
  - `model/heartbeat.ts`: `HEARTBEAT_MAX_AGE_MS = 26 * 3_600_000`, `isStale(lastCheckInAt: number | null, now: number, maxAgeMs?: number): boolean`

- [ ] **Step 1: Write failing tests**

`convex/lib/logger.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { log, redact, sanitizeError } from "./logger";

afterEach(() => vi.restoreAllMocks());

test("redact masks personal keys and email-shaped strings, recursively", () => {
  expect(
    redact({
      event: "x",
      email: "ana@example.com",
      recipient: { email: "a@b.co", firstName: "Ana" },
      note: "contact ana@example.com today",
      nested: [{ name: "Ana Pérez", count: 2 }],
    }),
  ).toEqual({
    event: "x",
    email: "[redacted]",
    recipient: "[redacted]",
    note: "contact [email] today",
    nested: [{ name: "[redacted]", count: 2 }],
  });
});

test("sanitizeError strips emails, collapses whitespace and truncates", () => {
  expect(sanitizeError("Failed for ana@example.com\n  retry", 300)).toBe("Failed for [email] retry");
  expect(sanitizeError("x".repeat(400)).length).toBe(300);
});

test("log writes one redacted JSON line", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log.info("outbox.delivered", { eventId: "e1", email: "ana@example.com" });
  const line = JSON.parse(spy.mock.calls[0][0] as string);
  expect(line).toEqual({ level: "info", event: "outbox.delivered", eventId: "e1", email: "[redacted]" });
});
```

`convex/model/delivery.test.ts`:

```ts
import { expect, test } from "vitest";
import { BACKOFF_MS, MAX_ATTEMPTS, classifyStatus, nextRetryDelay } from "./delivery";

test.each([
  [200, "delivered"],
  [202, "delivered"],
  [408, "retry"],
  [429, "retry"],
  [500, "retry"],
  [503, "retry"],
  [400, "dead"],
  [401, "dead"],
  [404, "dead"],
])("HTTP %i → %s", (status, outcome) => {
  expect(classifyStatus(status)).toBe(outcome);
});

test("backoff schedule then give up", () => {
  expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
  expect(nextRetryDelay(1)).toBe(30_000);
  expect(nextRetryDelay(4)).toBe(3_600_000);
  expect(nextRetryDelay(MAX_ATTEMPTS)).toBeNull();
});
```

`convex/model/heartbeat.test.ts`:

```ts
import { expect, test } from "vitest";
import { HEARTBEAT_MAX_AGE_MS, isStale } from "./heartbeat";

test("stale after 26 hours or when the cron never checked in", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  expect(isStale(null, now)).toBe(true);
  expect(isStale(now - HEARTBEAT_MAX_AGE_MS + 1, now)).toBe(false);
  expect(isStale(now - HEARTBEAT_MAX_AGE_MS - 1, now)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `pnpm vitest run convex/lib/logger.test.ts convex/model/delivery.test.ts convex/model/heartbeat.test.ts` → FAIL.

`convex/lib/logger.ts`:

```ts
// Structured JSON logs with personal data removed before anything is written.
const REDACTED_KEYS = new Set(["email", "name", "firstName", "message", "recipient", "body"]);
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]");
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, REDACTED_KEYS.has(key) ? "[redacted]" : redact(inner, depth + 1)]),
    );
  }
  return value;
}

export function sanitizeError(text: string, max = 300): string {
  return text.replace(EMAIL, "[email]").replace(/\s+/g, " ").trim().slice(0, max);
}

type Level = "info" | "warn" | "error";
function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ...(redact(fields) as Record<string, unknown>) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
```

`convex/model/delivery.ts`:

```ts
// Pure delivery rules for outbox events sent to n8n.
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const REQUEST_TIMEOUT_MS = 10_000;
export const CLAIM_LEASE_MS = 60_000;

export type DeliveryOutcome = "delivered" | "retry" | "dead";

export function classifyStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "dead"; // other 4xx: configuration problem, retrying will not help
}

// attemptsMade counts the attempt that just failed.
export function nextRetryDelay(attemptsMade: number): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[attemptsMade - 1] ?? null;
}
```

`convex/model/heartbeat.ts`:

```ts
export const HEARTBEAT_MAX_AGE_MS = 26 * 3_600_000; // daily cron plus slack

export function isStale(lastCheckInAt: number | null, now: number, maxAgeMs = HEARTBEAT_MAX_AGE_MS): boolean {
  return lastCheckInAt === null || now - lastCheckInAt > maxAgeMs;
}
```

Note: the console spy in the logger test must use `mockImplementation` to keep test output clean; the `log.info` path uses `console.log`.

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run convex/lib/logger.test.ts convex/model/delivery.test.ts convex/model/heartbeat.test.ts && pnpm typecheck && pnpm lint` → PASS.

```bash
git add convex/lib/logger.ts convex/lib/logger.test.ts convex/model/delivery.ts convex/model/delivery.test.ts convex/model/heartbeat.ts convex/model/heartbeat.test.ts
git commit -m "feat(integration): add redacting logger and pure delivery/heartbeat rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Payload contract and builder

**Files:**
- Modify: `convex/automation/contract.ts`
- Create: `convex/lib/integrationConfig.ts`, `convex/automation/payloads.ts`
- Test: `convex/automation/payloads.test.ts`

**Interfaces:**
- Produces:
  - `contract.ts` additions: `interface NotificationPayloadV1`, `PAYLOAD_KEYS` (exact allowed keys per object level).
  - `integrationConfig.ts`: `inboundSecrets(): string[]`, `type OutboundConfig = { ok: true; url: string; secret: string } | { ok: false; error: string }`, `outboundConfig(): OutboundConfig`, `appUrl(): string`, `clerkWebhookSecret(): string | null`
  - `payloads.ts`: `buildNotificationPayload(ctx: QueryCtx, event: Doc<"outboxEvents">, appUrl: string): Promise<NotificationPayloadV1 | null>` (null when the recipient is deleted or has no email)

- [ ] **Step 1: Extend `convex/automation/contract.ts`**

Append:

```ts
import type { EventType } from "../lib/validators";
import type { LoanStatus } from "../model/loanMachine";

// Only what the email needs. Never: last names, the counterpart's email,
// the borrower's message, tool descriptions, internal user IDs.
export interface NotificationPayloadV1 {
  schemaVersion: 1;
  eventId: string;
  type: EventType;
  occurredAt: string;
  recipient: { email: string; firstName: string };
  tool: { name: string };
  loan: { id: string; status: LoanStatus; startDate: string; endDate: string } | null;
  counterpartFirstName: string | null;
  actionUrl: string;
}

export const PAYLOAD_KEYS = {
  top: [
    "actionUrl",
    "counterpartFirstName",
    "eventId",
    "loan",
    "occurredAt",
    "recipient",
    "schemaVersion",
    "tool",
    "type",
  ],
  recipient: ["email", "firstName"],
  tool: ["name"],
  loan: ["endDate", "id", "startDate", "status"],
} as const;
```

(Move the two new `import type` lines to the top of the file.)

- [ ] **Step 2: Implement `convex/lib/integrationConfig.ts`**

```ts
// The only place that reads integration environment variables.
import { MIN_SECRET_LENGTH } from "../automation/contract";

function secret(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.length >= MIN_SECRET_LENGTH ? value : null;
}

export function inboundSecrets(): string[] {
  return [secret("CONVEX_INBOUND_SECRET"), secret("CONVEX_INBOUND_SECRET_PREVIOUS")].filter(
    (value): value is string => value !== null,
  );
}

export type OutboundConfig = { ok: true; url: string; secret: string } | { ok: false; error: string };

export function outboundConfig(): OutboundConfig {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return { ok: false, error: "N8N_WEBHOOK_URL is not set" };
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "N8N_WEBHOOK_URL is not a valid URL" };
  }
  const current = secret("N8N_WEBHOOK_SECRET");
  if (!current) return { ok: false, error: `N8N_WEBHOOK_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters` };
  return { ok: true, url, secret: current };
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function clerkWebhookSecret(): string | null {
  const value = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  return value && value.startsWith("whsec_") ? value : null;
}
```

- [ ] **Step 3: Implement `convex/automation/payloads.ts`**

```ts
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { firstName } from "../lib/displayName";
import type { NotificationPayloadV1 } from "./contract";

export async function buildNotificationPayload(
  ctx: QueryCtx,
  event: Doc<"outboxEvents">,
  appUrl: string,
): Promise<NotificationPayloadV1 | null> {
  const recipient = await ctx.db.get(event.recipientId);
  if (!recipient || recipient.deletedAt !== undefined || !recipient.email) return null;

  const loan = event.loanId ? await ctx.db.get(event.loanId) : null;
  const toolId = event.toolId ?? loan?.toolId;
  const tool = toolId ? await ctx.db.get(toolId) : null;

  let counterpartFirstName: string | null = null;
  if (loan) {
    const otherId = loan.ownerId === recipient._id ? loan.borrowerId : loan.ownerId;
    const other = await ctx.db.get(otherId);
    counterpartFirstName = other && other.deletedAt === undefined ? firstName(other.name) : null;
  }

  return {
    schemaVersion: 1,
    eventId: event._id,
    type: event.type,
    occurredAt: new Date(event._creationTime).toISOString(),
    recipient: { email: recipient.email, firstName: firstName(recipient.name) },
    tool: { name: tool?.name ?? "a tool" },
    loan: loan ? { id: loan._id, status: loan.status, startDate: loan.startDate, endDate: loan.endDate } : null,
    counterpartFirstName,
    actionUrl: loan ? `${appUrl}/loans/${loan._id}` : `${appUrl}/me/listings`,
  };
}
```

- [ ] **Step 4: Write tests**

`convex/automation/payloads.test.ts`:

```ts
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
```

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run convex/automation/payloads.test.ts && pnpm typecheck && pnpm lint` → PASS.

```bash
git add convex/automation convex/lib/integrationConfig.ts
git commit -m "feat(integration): add versioned notification payload with field allowlist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Outbox delivery with retries and dead letters

**Files:**
- Modify: `convex/automation/outbox.ts`
- Create: `convex/automation/delivery.ts`
- Test: `convex/automation/delivery.test.ts`

**Interfaces:**
- Consumes: `sign`, `signatureHeader` (Task 1); `classifyStatus`, `nextRetryDelay`, `REQUEST_TIMEOUT_MS`, `CLAIM_LEASE_MS` (Task 2); `buildNotificationPayload`, `outboundConfig`, `appUrl` (Task 3); `log`, `sanitizeError`.
- Produces:
  - `outbox.ts`: `enqueueEvent(ctx, event: { type; recipientId; loanId?; toolId?; replayOf?: Id<"outboxEvents"> })` now also schedules `internal.automation.delivery.deliver` with `runAfter(0)`.
  - `delivery.ts`: `deliver` (internalAction `{ eventId }`), internal mutations `claim`, `markDelivered`, `scheduleRetry`, `markDead`, `markSkipped`, internal query `payloadFor`.

- [ ] **Step 1: Schedule delivery from `enqueueEvent`**

Replace `convex/automation/outbox.ts` with:

```ts
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { EventType } from "../lib/validators";

// Stores IDs only. Scheduling from a mutation is atomic with its commit: if
// the state change rolls back, the event and its delivery never exist.
export async function enqueueEvent(
  ctx: MutationCtx,
  event: {
    type: EventType;
    recipientId: Id<"users">;
    loanId?: Id<"loans">;
    toolId?: Id<"tools">;
    replayOf?: Id<"outboxEvents">;
  },
): Promise<Id<"outboxEvents">> {
  const eventId = await ctx.db.insert("outboxEvents", {
    ...event,
    schemaVersion: 1,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.automation.delivery.deliver, { eventId });
  return eventId;
}
```

- [ ] **Step 2: Implement `convex/automation/delivery.ts`**

```ts
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { sign, signatureHeader } from "../lib/hmac";
import { appUrl, outboundConfig } from "../lib/integrationConfig";
import { log, sanitizeError } from "../lib/logger";
import { CLAIM_LEASE_MS, REQUEST_TIMEOUT_MS, classifyStatus, nextRetryDelay } from "../model/delivery";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";
import { buildNotificationPayload } from "./payloads";

const vEventId = { eventId: v.id("outboxEvents") };

export const claim = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || (event.status !== "pending" && event.status !== "retrying")) return null;
    const now = Date.now();
    if ((event.nextAttemptAt ?? 0) > now) return null; // another attempt holds the lease
    const attempts = event.attempts + 1;
    await ctx.db.patch(eventId, { attempts, nextAttemptAt: now + CLAIM_LEASE_MS });
    return { attempts };
  },
});

export const payloadFor = internalQuery({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    return event ? await buildNotificationPayload(ctx, event, appUrl()) : null;
  },
});

export const markDelivered = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    // Never downgrade: n8n may already have written back "sent", or reported a failure.
    if (!event || (event.status !== "pending" && event.status !== "retrying")) return;
    await ctx.db.patch(eventId, { status: "delivered", deliveredAt: Date.now(), nextAttemptAt: undefined });
  },
});

export const markSkipped = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    await ctx.db.patch(eventId, { status: "skipped", nextAttemptAt: undefined });
  },
});

export const markDead = internalMutation({
  args: { ...vEventId, error: v.string() },
  handler: async (ctx, { eventId, error }) => {
    await ctx.db.patch(eventId, { status: "dead", lastError: sanitizeError(error), nextAttemptAt: undefined });
    log.error("outbox.dead", { eventId, error });
  },
});

export const scheduleRetry = internalMutation({
  args: { ...vEventId, error: v.string() },
  handler: async (ctx, { eventId, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return;
    const delay = nextRetryDelay(event.attempts);
    if (delay === null) {
      await ctx.db.patch(eventId, { status: "dead", lastError: sanitizeError(error), nextAttemptAt: undefined });
      log.error("outbox.dead", { eventId, attempts: event.attempts, error });
      return;
    }
    await ctx.db.patch(eventId, { status: "retrying", lastError: sanitizeError(error), nextAttemptAt: Date.now() + delay });
    await ctx.scheduler.runAfter(delay, internal.automation.delivery.deliver, { eventId });
    log.warn("outbox.retry", { eventId, attempts: event.attempts, delayMs: delay });
  },
});

export const deliver = internalAction({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const claimed = await ctx.runMutation(internal.automation.delivery.claim, { eventId });
    if (!claimed) return;

    const config = outboundConfig();
    if (!config.ok) {
      await ctx.runMutation(internal.automation.delivery.markDead, { eventId, error: config.error });
      return;
    }
    const payload = await ctx.runQuery(internal.automation.delivery.payloadFor, { eventId });
    if (!payload) {
      await ctx.runMutation(internal.automation.delivery.markSkipped, { eventId });
      return;
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(config.secret, timestamp, "POST", new URL(config.url).pathname, body);

    let outcome: "delivered" | "retry" | "dead";
    let error = "";
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signatureHeader(signature),
          [EVENT_ID_HEADER]: eventId,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      outcome = classifyStatus(response.status);
      error = `n8n responded ${response.status}`;
    } catch (caught) {
      outcome = "retry";
      error = sanitizeError(String(caught));
    }

    if (outcome === "delivered") {
      await ctx.runMutation(internal.automation.delivery.markDelivered, { eventId });
      log.info("outbox.delivered", { eventId, attempts: claimed.attempts });
    } else if (outcome === "retry") {
      await ctx.runMutation(internal.automation.delivery.scheduleRetry, { eventId, error });
    } else {
      await ctx.runMutation(internal.automation.delivery.markDead, { eventId, error });
    }
  },
});
```

- [ ] **Step 3: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 4: Write tests**

`convex/automation/delivery.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { NOW, seedWorld, setupTest } from "../test.helpers";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";
import { verifySignature } from "../lib/hmac";

const SECRET = "n8n-webhook-secret-0123456789abcdef0123";
const URL_ = "http://n8n.test/webhook/lendloop-loan-events";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("N8N_WEBHOOK_URL", URL_);
  vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("APP_URL", "https://lendloop.test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 202 }));
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
    nowMs: NOW,
  });
  expect(verdict).toEqual({ ok: true });
  expect(JSON.parse(init.body as string)).toMatchObject({ recipient: { email: "alice@example.com", firstName: "Alice" } });
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
```

- [ ] **Step 5: Run the suite**

Run: `pnpm vitest run convex/automation/delivery.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Plan 1 tests still pass: they use fake timers and never advance them, so scheduled deliveries never run there. If convex-test reports open scheduled functions as errors in Plan 1 tests, stub `fetch` and env in `setupTest` instead of per test.

- [ ] **Step 6: Commit**

```bash
git add convex
git commit -m "feat(integration): deliver outbox events to n8n with signed requests and backoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Signed inbound endpoints (overdue loans, reminders, notification status, errors, health)

**Files:**
- Modify: `convex/automation/contract.ts`, `convex/lib/rateLimits.ts`, `convex/crons.ts`
- Create: `convex/automation/inbound.ts`, `convex/automation/reminders.ts`, `convex/automation/heartbeat.ts`, `convex/automation/notifications.ts`, `convex/automation/errors.ts`, `convex/http.ts`
- Test: `convex/http.test.ts`

**Interfaces:**
- Produces:
  - `contract.ts` additions: validators `vReminderReport`, `vNotificationStatus`, `vAutomationError`; `interface OverdueLoanV1 { loanId: string; idempotencyKey: string; borrower: { email: string; firstName: string }; tool: { name: string }; endDate: string; daysOverdue: number }`.
  - `inbound.ts`: `json(status: number, body: unknown): Response`, `signedEndpoint(handler: (ctx: ActionCtx, body: unknown) => Promise<Response>)` returning an `httpAction`.
  - `reminders.ts`: `overdueLoans` (internalQuery → `OverdueLoanV1[]`), `recordReminder` (internalMutation → `{ duplicate: boolean }`).
  - `heartbeat.ts`: `checkIn` (internalMutation), `checkStale` (internalMutation for the cron), `REMINDER_WORKFLOW = "overdue-reminders"`.
  - `notifications.ts`: `recordNotificationStatus` (internalMutation `{ eventId: string; status: "sent"; executionId: string }` → `{ updated: boolean }`).
  - `errors.ts`: `recordError` (internalMutation → `{ duplicate: boolean }`).
  - Routes: `GET /health`, `GET /n8n/overdue-loans`, `POST /n8n/reminders`, `POST /n8n/notifications/status`, `POST /n8n/automation-errors`.

- [ ] **Step 1: Add validators to `contract.ts`**

Append (and add `import { v } from "convex/values";` at the top):

```ts
export interface OverdueLoanV1 {
  loanId: string;
  idempotencyKey: string; // "<loanId>:<YYYY-MM-DD>"
  borrower: { email: string; firstName: string };
  tool: { name: string };
  endDate: string;
  daysOverdue: number;
}

export const vReminderReport = v.object({
  loanId: v.string(),
  idempotencyKey: v.string(),
  status: v.union(v.literal("sent"), v.literal("failed")),
  executionId: v.string(),
  error: v.optional(v.string()),
});

export const vNotificationStatus = v.object({
  eventId: v.string(),
  status: v.literal("sent"),
  executionId: v.string(),
});

export const vAutomationError = v.object({
  workflow: v.string(),
  executionId: v.string(),
  node: v.optional(v.string()),
  message: v.string(),
  eventId: v.optional(v.string()),
});
```

- [ ] **Step 2: Add rate limits**

In `convex/lib/rateLimits.ts` add `MINUTE` to the import and two entries to the config:

```ts
  inboundHttp: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 240 },
  clerkWebhook: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 120 },
```

- [ ] **Step 3: Implement `convex/automation/inbound.ts`**

```ts
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../lib/functions";
import { verifySignature } from "../lib/hmac";
import { inboundSecrets } from "../lib/integrationConfig";
import { log } from "../lib/logger";
import { rateLimiter } from "../lib/rateLimits";
import { MAX_BODY_BYTES, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export class InvalidBody extends Error {}

// Every n8n → Convex endpoint goes through here, so none can skip a check.
export function signedEndpoint(handler: (ctx: ActionCtx, body: unknown) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const path = new URL(request.url).pathname;
    const { ok: withinLimit } = await rateLimiter.limit(ctx, "inboundHttp", { key: "n8n" });
    if (!withinLimit) return json(429, { error: "rate_limited" });

    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      return json(413, { error: "too_large" });
    }
    if (request.method === "POST" && !(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return json(415, { error: "unsupported_media_type" });
    }
    const raw = request.method === "GET" ? "" : await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "too_large" });

    const secrets = inboundSecrets();
    if (secrets.length === 0) {
      log.error("inbound.not_configured", { path });
      return json(503, { error: "not_configured" });
    }
    const verdict = await verifySignature({
      secrets,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      method: request.method,
      path,
      body: raw,
    });
    if (!verdict.ok) {
      log.warn("inbound.rejected", { path, reason: verdict.reason });
      return json(401, { error: "unauthorized" });
    }

    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: "invalid_body" });
      }
    }
    try {
      return await handler(ctx, body);
    } catch (error) {
      if (error instanceof InvalidBody) return json(400, { error: "invalid_body" });
      log.error("inbound.failed", { path, error: String(error) });
      return json(500, { error: "internal" });
    }
  });
}
```

- [ ] **Step 4: Implement the internal functions**

`convex/automation/heartbeat.ts`:

```ts
import { internalMutation } from "../lib/functions";
import { log } from "../lib/logger";
import { isStale } from "../model/heartbeat";

export const REMINDER_WORKFLOW = "overdue-reminders" as const;

export const checkIn = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastCheckInAt: Date.now() });
    else await ctx.db.insert("automationHeartbeats", { workflow: REMINDER_WORKFLOW, lastCheckInAt: Date.now() });
  },
});

// Hourly dead-man's switch: the error workflow can't report a cron that never ran.
export const checkStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const beat = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    const stale = isStale(beat?.lastCheckInAt ?? null, Date.now());
    if (stale) log.warn("heartbeat.stale", { workflow: REMINDER_WORKFLOW, lastCheckInAt: beat?.lastCheckInAt ?? null });
    return { stale };
  },
});
```

`convex/automation/reminders.ts`:

```ts
import { v } from "convex/values";
import { audit } from "../lib/audit";
import { today } from "../lib/config";
import { firstName } from "../lib/displayName";
import { internalMutation, internalQuery } from "../lib/functions";
import { sanitizeError } from "../lib/logger";
import { daysOverdue } from "../model/dates";
import type { OverdueLoanV1 } from "./contract";

export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx): Promise<OverdueLoanV1[]> => {
    const t0 = today();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "active").lt("endDate", t0))
      .take(200);
    const rows: OverdueLoanV1[] = [];
    for (const loan of loans) {
      const idempotencyKey = `${loan._id}:${t0}`;
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing?.status === "sent") continue; // already reminded today
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower || borrower.deletedAt !== undefined || !borrower.email) continue;
      const tool = await ctx.db.get(loan.toolId);
      rows.push({
        loanId: loan._id,
        idempotencyKey,
        borrower: { email: borrower.email, firstName: firstName(borrower.name) },
        tool: { name: tool?.name ?? "a tool" },
        endDate: loan.endDate,
        daysOverdue: daysOverdue(loan.endDate, t0),
      });
    }
    return rows;
  },
});

export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    executionId: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    // Don't trust n8n blindly: the key must be today's key for a real loan
    // that was out on loan (it may have been returned since the fetch).
    if (!loan || args.idempotencyKey !== `${loan._id}:${today()}` || (loan.status !== "active" && loan.status !== "returned")) {
      return { accepted: false as const };
    }
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", n8nExecutionId: args.executionId, error: undefined });
        return { accepted: true as const, duplicate: false };
      }
      return { accepted: true as const, duplicate: true };
    }
    await ctx.db.insert("reminders", {
      loanId: loan._id,
      idempotencyKey: args.idempotencyKey,
      status: args.status,
      n8nExecutionId: args.executionId,
      error: args.error ? sanitizeError(args.error) : undefined,
    });
    await audit(ctx, {
      actorType: "n8n",
      action: `reminder.${args.status}`,
      entityType: "loan",
      entityId: loan._id,
    });
    return { accepted: true as const, duplicate: false };
  },
});
```

`convex/automation/notifications.ts`:

```ts
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";

// n8n confirms the email was actually sent. This may arrive before Convex has
// recorded "delivered", so any state except "skipped" can move to "sent".
export const recordNotificationStatus = internalMutation({
  args: { eventId: v.string(), status: v.literal("sent"), executionId: v.string() },
  handler: async (ctx, args) => {
    const eventId = ctx.db.normalizeId("outboxEvents", args.eventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    if (!event) return { found: false as const };
    if (event.status === "sent" || event.status === "skipped") return { found: true as const, updated: false };
    await ctx.db.patch(event._id, { status: "sent", sentAt: Date.now(), nextAttemptAt: undefined });
    return { found: true as const, updated: true };
  },
});
```

`convex/automation/errors.ts`:

```ts
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { log, sanitizeError } from "../lib/logger";

export const recordError = internalMutation({
  args: {
    workflow: v.string(),
    executionId: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    eventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationErrors")
      .withIndex("by_executionId", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { duplicate: true };

    const eventId = args.eventId ? ctx.db.normalizeId("outboxEvents", args.eventId) : null;
    const message = sanitizeError(args.message, 500);
    await ctx.db.insert("automationErrors", {
      workflow: args.workflow.slice(0, 100),
      executionId: args.executionId.slice(0, 100),
      node: args.node?.slice(0, 100),
      message,
      eventId: eventId ?? undefined,
    });
    if (eventId) {
      const event = await ctx.db.get(eventId);
      if (event && event.status !== "sent") {
        await ctx.db.patch(eventId, { status: "failed", lastError: message, nextAttemptAt: undefined });
      }
    }
    log.error("automation.error", { workflow: args.workflow, executionId: args.executionId, node: args.node });
    return { duplicate: false };
  },
});
```

- [ ] **Step 5: Implement `convex/http.ts` and the heartbeat cron**

```ts
import { httpRouter } from "convex/server";
import { validate } from "convex-helpers/validators";
import { internal } from "./_generated/api";
import { vAutomationError, vNotificationStatus, vReminderReport } from "./automation/contract";
import { InvalidBody, json, signedEndpoint } from "./automation/inbound";
import { httpAction } from "./lib/functions";

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json(200, { ok: true })),
});

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: signedEndpoint(async (ctx) => {
    await ctx.runMutation(internal.automation.heartbeat.checkIn, {});
    const loans = await ctx.runQuery(internal.automation.reminders.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vReminderReport, body)) throw new InvalidBody();
    const result = await ctx.runMutation(internal.automation.reminders.recordReminder, body);
    return result.accepted ? json(200, result) : json(422, { error: "rejected" });
  }),
});

http.route({
  path: "/n8n/notifications/status",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vNotificationStatus, body)) throw new InvalidBody();
    const result = await ctx.runMutation(internal.automation.notifications.recordNotificationStatus, body);
    return result.found ? json(200, result) : json(404, { error: "not_found" });
  }),
});

http.route({
  path: "/n8n/automation-errors",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vAutomationError, body)) throw new InvalidBody();
    return json(200, await ctx.runMutation(internal.automation.errors.recordError, body));
  }),
});

export default http;
```

In `convex/crons.ts` add:

```ts
crons.hourly("check reminder heartbeat", { minuteUTC: 15 }, internal.automation.heartbeat.checkStale, {});
```

- [ ] **Step 6: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 7: Write HTTP tests**

`convex/http.test.ts`:

```ts
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
    const ts = String(Math.floor(NOW / 1000));
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

  test("not configured → 503; wrong content type → 415; oversize → 413; bad body → 400", async () => {
    const t = setupTest();
    vi.stubEnv("CONVEX_INBOUND_SECRET", "");
    expect((await signedFetch(t, "GET", "/n8n/overdue-loans")).status).toBe(503);
    vi.stubEnv("CONVEX_INBOUND_SECRET", SECRET);

    const text = await t.fetch("/n8n/reminders", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(text.status).toBe(415);
    const big = await signedFetch(t, "POST", "/n8n/automation-errors", { workflow: "w", executionId: "1", message: "x".repeat(70_000) });
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

    expect(await (await signedFetch(t, "POST", "/n8n/reminders", { ...report, status: "failed", error: "SMTP down for bob@example.com" })).json()).toMatchObject({ duplicate: false });
    expect(await (await signedFetch(t, "POST", "/n8n/reminders", { ...report, status: "sent" })).json()).toMatchObject({ duplicate: false });
    expect(await (await signedFetch(t, "POST", "/n8n/reminders", { ...report, status: "sent" })).json()).toMatchObject({ duplicate: true });
    expect(await (await signedFetch(t, "POST", "/n8n/reminders", { ...report, status: "failed" })).json()).toMatchObject({ duplicate: true });

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
      await ctx.db.insert("outboxEvents", { type: "loan.requested", schemaVersion: 1, recipientId: w.alice.id, loanId, status: "pending", attempts: 1 }),
      await ctx.db.insert("outboxEvents", { type: "loan.requested", schemaVersion: 1, recipientId: w.alice.id, loanId, status: "delivered", attempts: 1 }),
    ]);

    const sent = await signedFetch(t, "POST", "/n8n/notifications/status", { eventId: sentId, status: "sent", executionId: "e1" });
    expect(await sent.json()).toMatchObject({ updated: true });

    const error = { workflow: "loan-notifications", executionId: "e2", node: "Send Email", message: "550 rejected for alice@example.com", eventId: failedId };
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

    const unknown = await signedFetch(t, "POST", "/n8n/notifications/status", { eventId: "nope", status: "sent", executionId: "e3" });
    expect(unknown.status).toBe(404);
  });
});
```

- [ ] **Step 8: Run and commit**

Run: `pnpm vitest run convex/http.test.ts && pnpm test && pnpm typecheck && pnpm lint` → PASS.

```bash
git add convex
git commit -m "feat(integration): add signed n8n endpoints for reminders, status, errors and health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Clerk webhook and account deletion

**Files:**
- Modify: `convex/users.ts`, `convex/lib/tools.ts`, `convex/http.ts`
- Create: `convex/clerkWebhook.ts`
- Test: `convex/clerkWebhook.test.ts`

**Interfaces:**
- Consumes: `clerkWebhookSecret` (Task 3), `removeToolCascade`, `applyLoanTransition`, `rateLimiter`.
- Produces: `internal.users.applyClerkUpdate({ clerkId, name, email })`, `internal.users.deleteAccount({ clerkId }) → { deleted: boolean }`, route `POST /clerk/webhook`. `removeToolCascade` input `actorId?: Id<"users">`, `actorType: "user" | "admin" | "system"`.

- [ ] **Step 1: Install svix**

Run: `pnpm add svix@2.9`

- [ ] **Step 2: Let `removeToolCascade` run as the system**

In `convex/lib/tools.ts`, change the input type to `actorId?: Id<"users">; actorType: "user" | "admin" | "system";` (everything else unchanged; `removedBy: input.actorId` already accepts `undefined`).

- [ ] **Step 3: Add internal mutations to `convex/users.ts`**

Add imports `import { v } from "convex/values";`, `import { internalMutation } from "./lib/functions";` (merge), `import { audit } from "./lib/audit";`, `import { applyLoanTransition } from "./lib/loanTransitions";`, `import { removeToolCascade } from "./lib/tools";`, then append:

```ts
export const applyClerkUpdate = internalMutation({
  args: { clerkId: v.string(), name: v.string(), email: v.union(v.string(), v.null()) },
  handler: async (ctx, { clerkId, name, email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    // Webhooks are unordered: never resurrect data for a deleted account.
    if (!user || user.deletedAt !== undefined) return;
    await ctx.db.patch(user._id, { name: name.trim() || user.name, email });
  },
});

export const deleteAccount = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user || user.deletedAt !== undefined) return { deleted: false };

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    for (const tool of tools.filter((t) => t.status === "listed")) {
      await removeToolCascade(ctx, { tool, actorType: "system", reason: "account_deleted", notifyOwner: false });
    }

    for (const status of ["pending", "approved"] as const) {
      const borrowed = await ctx.db
        .query("loans")
        .withIndex("by_borrower_status", (q) => q.eq("borrowerId", user._id).eq("status", status))
        .collect();
      for (const loan of borrowed) {
        await applyLoanTransition(ctx, {
          loan,
          action: "closeForAccountDeletion",
          actor: "system",
          actorType: "system",
          closeReason: "account_deleted",
          notify: [{ type: "loan.cancelled", recipientId: loan.ownerId }],
        });
      }
    }

    // Anonymize. Active loans stay so the other party can close them.
    await ctx.db.patch(user._id, {
      name: "Former neighbour",
      email: null,
      isTrustedLender: false,
      deletedAt: Date.now(),
    });
    await audit(ctx, { actorType: "system", action: "user.delete", entityType: "user", entityId: user._id });
    return { deleted: true };
  },
});
```

- [ ] **Step 4: Implement `convex/clerkWebhook.ts`**

```ts
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { json } from "./automation/inbound";
import { MAX_BODY_BYTES } from "./automation/contract";
import { httpAction } from "./lib/functions";
import { clerkWebhookSecret } from "./lib/integrationConfig";
import { log } from "./lib/logger";
import { rateLimiter } from "./lib/rateLimits";

type ClerkEmail = { id: string; email_address: string };
type ClerkUserEvent =
  | {
      type: "user.updated";
      data: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        primary_email_address_id: string | null;
        email_addresses: ClerkEmail[];
      };
    }
  | { type: "user.deleted"; data: { id?: string; deleted?: boolean } }
  | { type: string; data: unknown };

export const clerkWebhook = httpAction(async (ctx, request) => {
  const { ok } = await rateLimiter.limit(ctx, "clerkWebhook", { key: "clerk" });
  if (!ok) return json(429, { error: "rate_limited" });
  const secret = clerkWebhookSecret();
  if (!secret) return json(503, { error: "not_configured" });

  const payload = await request.text();
  if (new TextEncoder().encode(payload).length > MAX_BODY_BYTES) return json(413, { error: "too_large" });

  let event: ClerkUserEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as ClerkUserEvent;
  } catch {
    log.warn("clerk_webhook.rejected", {});
    return json(401, { error: "unauthorized" });
  }

  if (event.type === "user.updated") {
    const data = (event as Extract<ClerkUserEvent, { type: "user.updated" }>).data;
    const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
    await ctx.runMutation(internal.users.applyClerkUpdate, {
      clerkId: data.id,
      name: [data.first_name, data.last_name].filter(Boolean).join(" "),
      email: primary?.email_address ?? null,
    });
  } else if (event.type === "user.deleted") {
    const data = (event as Extract<ClerkUserEvent, { type: "user.deleted" }>).data;
    if (data.id) await ctx.runMutation(internal.users.deleteAccount, { clerkId: data.id });
  }
  return json(200, { ok: true });
});
```

Register in `convex/http.ts` (import `clerkWebhook` from `./clerkWebhook`):

```ts
http.route({ path: "/clerk/webhook", method: "POST", handler: clerkWebhook });
```

- [ ] **Step 5: Push**

Run: `pnpm convex:push` → success. If bundling `svix` fails in the default runtime, report it (Convex documents this exact usage, so it is not expected).

- [ ] **Step 6: Write tests**

`convex/clerkWebhook.test.ts`:

```ts
import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, insertLoan, seedWorld, setupTest, type TestT } from "./test.helpers";

// whsec_ + base64 of 32 bytes (test-only)
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

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
  const timestamp = new Date(NOW);
  const signature = new Webhook(secret).sign(id, timestamp, payload);
  return await t.fetch("/clerk/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(NOW / 1000)),
      "svix-signature": signature,
    },
    body: payload,
  });
}

test("rejects bad signatures", async () => {
  const t = setupTest();
  const res = await post(t, { type: "user.deleted", data: { id: "user_alice" } }, "whsec_" + "A".repeat(32));
  expect(res.status).toBe(401);
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
  expect(await t.run((ctx) => ctx.db.get(w.alice.id))).toMatchObject({ name: "Alicia Moreno", email: "alicia@example.com" });
});

test("user.deleted anonymizes, removes listings, cancels open requests, keeps active loans", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const ownersPending = await insertLoan(t, w); // bob borrows alice's tool
  const active = await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-10-30", endDate: "2026-11-03" });

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
```

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run convex/clerkWebhook.test.ts && pnpm test && pnpm typecheck && pnpm lint` → PASS.

```bash
git add convex package.json pnpm-lock.yaml
git commit -m "feat(users): handle Clerk webhooks with Svix and anonymize deleted accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Admin automation health, replay and resolve

**Files:**
- Modify: `convex/admin.ts`, `tests/authz/matrix.ts`, `convex/authz.test.ts`, `docs/authz-matrix.md` (regenerated)
- Test: `convex/admin.automation.test.ts`

**Interfaces:**
- Produces: `admin.automationHealth({}) → { counts: Record<OutboxStatus, number>; problems: { _id; type; status; attempts; lastError?; loanId?; at }[]; errors: { _id; workflow; executionId; node?; message; eventId?; at }[]; heartbeat: { lastCheckInAt: number | null; stale: boolean }; reminders24h: { sent: number; failed: number } }`, `admin.replayEvent({ eventId }) → Id<"outboxEvents">`, `admin.resolveError({ errorId }) → null`.

- [ ] **Step 1: Append to `convex/admin.ts`**

Add imports: `import { enqueueEvent } from "./automation/outbox";`, `import { REMINDER_WORKFLOW } from "./automation/heartbeat";`, `import { isStale } from "./model/heartbeat";`, `import { OUTBOX_STATUSES, type OutboxStatus } from "./lib/validators";` (merge with existing validators import). Then:

```ts
export const automationHealth = adminQuery({
  args: {},
  handler: async (ctx) => {
    const counts = {} as Record<OutboxStatus, number>;
    for (const status of OUTBOX_STATUSES) {
      counts[status] = (
        await ctx.db
          .query("outboxEvents")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(1000)
      ).length;
    }
    const problems = [];
    for (const status of ["dead", "failed"] as const) {
      const rows = await ctx.db
        .query("outboxEvents")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(25);
      problems.push(
        ...rows.map((e) => ({
          _id: e._id,
          type: e.type,
          status: e.status,
          attempts: e.attempts,
          lastError: e.lastError,
          loanId: e.loanId,
          at: e._creationTime,
        })),
      );
    }
    const errors = (
      await ctx.db
        .query("automationErrors")
        .withIndex("by_resolved", (q) => q.eq("resolvedAt", undefined))
        .order("desc")
        .take(50)
    ).map((e) => ({
      _id: e._id,
      workflow: e.workflow,
      executionId: e.executionId,
      node: e.node,
      message: e.message,
      eventId: e.eventId,
      at: e._creationTime,
    }));
    const beat = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    const since = Date.now() - 24 * 3_600_000;
    const recent = (await ctx.db.query("reminders").order("desc").take(500)).filter((r) => r._creationTime >= since);
    return {
      counts,
      problems: problems.sort((a, b) => b.at - a.at),
      errors,
      heartbeat: { lastCheckInAt: beat?.lastCheckInAt ?? null, stale: isStale(beat?.lastCheckInAt ?? null, Date.now()) },
      reminders24h: {
        sent: recent.filter((r) => r.status === "sent").length,
        failed: recent.filter((r) => r.status === "failed").length,
      },
    };
  },
});

export const replayEvent = adminMutation({
  args: { eventId: v.id("outboxEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw appError("NOT_FOUND", "Event not found");
    if (event.status !== "dead" && event.status !== "failed") {
      throw appError("CONFLICT", "Only failed or dead events can be replayed");
    }
    // A replay is a new intent with a new event ID, so n8n's dedupe of the
    // original ID does not swallow it.
    const replayId = await enqueueEvent(ctx, {
      type: event.type,
      recipientId: event.recipientId,
      loanId: event.loanId,
      toolId: event.toolId,
      replayOf: event._id,
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "admin",
      action: "outboxEvent.replay",
      entityType: "outboxEvent",
      entityId: event._id,
    });
    return replayId;
  },
});

export const resolveError = adminMutation({
  args: { errorId: v.id("automationErrors") },
  handler: async (ctx, { errorId }) => {
    const error = await ctx.db.get(errorId);
    if (!error) throw appError("NOT_FOUND", "Error not found");
    if (error.resolvedAt !== undefined) return null;
    await ctx.db.patch(errorId, { resolvedAt: Date.now(), resolvedBy: ctx.user._id });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "admin",
      action: "automationError.resolve",
      entityType: "automationError",
      entityId: errorId,
    });
    return null;
  },
});
```

- [ ] **Step 2: Extend the authorization matrix**

In `tests/authz/matrix.ts` append to `MATRIX`:

```ts
  { fn: "admin:automationHealth", description: "Outbox, errors and reminder heartbeat", expect: adminOnly },
  { fn: "admin:replayEvent", description: "Replay a failed notification", expect: adminOnly },
  { fn: "admin:resolveError", description: "Mark an automation error resolved", expect: adminOnly },
```

In `convex/authz.test.ts`: extend `Needs` with `"deadEvent" | "automationError"`, extend `Ctx` with `eventId: Id<"outboxEvents">; errorId: Id<"automationErrors">`, add the three calls:

```ts
  "admin:automationHealth": { kind: "query", ref: api.admin.automationHealth, needs: "none", args: () => ({}) },
  "admin:replayEvent": { kind: "mutation", ref: api.admin.replayEvent, needs: "deadEvent", args: (c) => ({ eventId: c.eventId }) },
  "admin:resolveError": { kind: "mutation", ref: api.admin.resolveError, needs: "automationError", args: (c) => ({ errorId: c.errorId }) },
```

and replace the fixture line computing `loanId` with:

```ts
    const loanStates = ["pending", "approved", "active"] as const;
    const loanId = loanStates.includes(call.needs as (typeof loanStates)[number])
      ? await insertLoan(t, w, { status: call.needs as (typeof loanStates)[number] })
      : (undefined as unknown as Id<"loans">);
    const eventId =
      call.needs === "deadEvent"
        ? await t.run((ctx) =>
            ctx.db.insert("outboxEvents", {
              type: "loan.requested",
              schemaVersion: 1,
              recipientId: w.alice.id,
              status: "dead",
              attempts: 5,
            }),
          )
        : (undefined as unknown as Id<"outboxEvents">);
    const errorId =
      call.needs === "automationError"
        ? await t.run((ctx) =>
            ctx.db.insert("automationErrors", { workflow: "loan-notifications", executionId: "x1", message: "boom" }),
          )
        : (undefined as unknown as Id<"automationErrors">);
```

and pass `{ ...w, loanId, eventId, errorId }` to `call.args`.

- [ ] **Step 3: Write behaviour tests**

`convex/admin.automation.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { HEARTBEAT_MAX_AGE_MS } from "./model/heartbeat";
import { NOW, expectCode, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("health reports counts, problems, unresolved errors and a stale heartbeat", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("outboxEvents", { type: "loan.requested", schemaVersion: 1, recipientId: w.alice.id, status: "dead", attempts: 5, lastError: "n8n responded 503" });
    await ctx.db.insert("outboxEvents", { type: "loan.approved", schemaVersion: 1, recipientId: w.bob.id, status: "sent", attempts: 1 });
    await ctx.db.insert("automationErrors", { workflow: "overdue-reminders", executionId: "e9", message: "SMTP timeout" });
    await ctx.db.insert("automationHeartbeats", { workflow: "overdue-reminders", lastCheckInAt: NOW - HEARTBEAT_MAX_AGE_MS - 1 });
  });
  const health = await w.dana.as.query(api.admin.automationHealth, {});
  expect(health.counts).toMatchObject({ dead: 1, sent: 1, pending: 0 });
  expect(health.problems).toMatchObject([{ type: "loan.requested", lastError: "n8n responded 503" }]);
  expect(health.errors).toMatchObject([{ workflow: "overdue-reminders", message: "SMTP timeout" }]);
  expect(health.heartbeat.stale).toBe(true);
});

test("replay creates a new pending event linked to the original; only for dead or failed", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const [deadId, sentId] = await t.run(async (ctx) => [
    await ctx.db.insert("outboxEvents", { type: "loan.requested", schemaVersion: 1, recipientId: w.alice.id, status: "dead", attempts: 5 }),
    await ctx.db.insert("outboxEvents", { type: "loan.requested", schemaVersion: 1, recipientId: w.alice.id, status: "sent", attempts: 1 }),
  ]);
  const replayId = await w.dana.as.mutation(api.admin.replayEvent, { eventId: deadId });
  expect(await t.run((ctx) => ctx.db.get(replayId))).toMatchObject({ status: "pending", attempts: 0, replayOf: deadId });
  await expectCode(w.dana.as.mutation(api.admin.replayEvent, { eventId: sentId }), "CONFLICT");
});

test("resolving an error hides it from the health view", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const errorId = await t.run((ctx) => ctx.db.insert("automationErrors", { workflow: "w", executionId: "e1", message: "m" }));
  await w.dana.as.mutation(api.admin.resolveError, { errorId });
  expect((await w.dana.as.query(api.admin.automationHealth, {})).errors).toEqual([]);
});
```

- [ ] **Step 4: Push, run, regenerate the matrix doc, commit**

Run: `pnpm convex:push && pnpm test && pnpm docs:authz && pnpm docs:authz --check && pnpm typecheck && pnpm lint` → PASS (matrix now 27 functions × 5 actors).

```bash
git add convex tests docs/authz-matrix.md
git commit -m "feat(admin): add automation health, notification replay and error resolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Plan 2a exit criteria

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm docs:authz --check` pass.
- A loan request schedules a signed POST to `N8N_WEBHOOK_URL`; failures retry with backoff and end in `dead`.
- All five inbound routes reject unsigned, stale, cross-path and oversized requests.
- Plan 2b (n8n) can be written against `convex/automation/contract.ts` and `contracts/hmac-vectors.json`.
