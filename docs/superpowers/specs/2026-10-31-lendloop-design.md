# LendLoop: Design Spec

- **Date:** 2026-10-31
- **Status:** Approved in brainstorming, pending written-spec review
- **Scope:** Full take-home (core requirements + bonus + agreed extras, tiers 1 and 2)

## 1. Context and goals

LendLoop is a neighbourhood tool-lending board. Neighbours list tools they are willing to lend, request to borrow each other's tools for a date range, and receive automated notifications and reminders handled by n8n.

Mandatory stack: Next.js (App Router), Clerk, Convex, n8n, TypeScript.

The reviewers build B2B products for mental-health clinicians and researchers, so the evaluation weighs:

1. Code structure and clarity
2. Security-minded thinking (OWASP, secrets management, auditability, data minimization, observability)
3. UX and practicality
4. Integration design, reliability and error handling (n8n)
5. Documentation and reasoning

Every design decision below should be defensible against those five criteria. When a choice trades convenience for safety, we choose safety and document the trade-off.

### Non-goals

Chat, ratings, photos, notification preferences, reminder escalation, payments or deposits, multiple neighbourhoods (tenancy), native mobile apps.

## 2. Decision summary

| # | Decision | Rationale |
|---|---|---|
| D1 | Public demo (Vercel + Convex cloud + n8n on Railway) **and** full local stack (docker-compose + Convex local deployment) | Reviewers can click a URL or run everything offline. Convex cloud cannot reach `localhost`, so local dev uses a Convex local deployment. |
| D2 | n8n runs from **our own Docker image** (`n8n/Dockerfile`), identical locally and on Railway | No official Railway template exists; one image means local equals prod. |
| D3 | Admin role lives in Clerk `publicMetadata.role`, exposed as a session-token claim and read by Convex on every call | Role comes from a signed token, never from client input or a mutable app table. `publicMetadata` is backend-writable only (never `unsafeMetadata`). Revocation takes effect within the 60 s token lifetime. |
| D4 | Loan lifecycle with explicit handover: `pending → approved → active → returned`, plus `declined`, `cancelled`, `expired`. Overdue is **derived**, never stored. | Overdue counts from the real handover. Deriving it removes a state-mutating job and a class of desync bugs. |
| D5 | Approving a request auto-declines overlapping pending requests (reason `dates_taken`) in the same transaction | Lender queue stays clean; each affected borrower is notified. |
| D6 | Email notifications: Mailpit locally, real SMTP in production | Email is 1:1. Slack or Discord webhooks would broadcast neighbours' loan data to a shared channel. |
| D7 | Transactional outbox in Convex with custom retries and a dead-letter state (approach A) | Explicit, auditable delivery state that also feeds the admin health panel and the loan timeline. |
| D8 | HMAC-SHA256 in both directions with **separate secrets per direction**, timestamp window, method+path binding, and zero-downtime rotation | Requirement, plus key separation and replay protection. |
| D9 | Outbox and logs store IDs only. Payloads containing email are built **at send time** | A user deleted between enqueue and send never leaks; nothing personal accumulates in the outbox. |
| D10 | n8n secrets live in **n8n credentials** (Crypto credential for HMAC, SMTP credential). `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`. Non-secret config is rendered into workflow templates at container start | Workflows cannot read the process environment, which also holds the n8n encryption key and DB password. Exported workflow JSON contains placeholders and credential references only. |
| D11 | Users are upserted from token claims on sign-in; Clerk webhooks (Svix-verified) handle `user.updated` and `user.deleted` | No dependency on webhooks for local dev; deletion anonymizes personal data. |
| D12 | Pending requests expire when their start date passes; approved loans expire if never handed over by their end date | Avoids zombie queues (pattern from Library of Things and Yclas). |
| D13 | UI direction "B · Ledger": IBM Plex Sans + IBM Plex Mono, cobalt accent, hairlines, keyboard hints, Linear/Stripe density, Paper Shaders `Dithering` band on the landing page | Chosen from a three-way comparison (`design/directions.html`). |

## 3. Architecture

```
                    ┌──────────── Clerk ────────────┐
                    │ session, JWT (role/email/name)│──Svix webhook──┐
                    └──────┬────────────────────────┘                │
                           │ JWT                                     ▼
 Browser ──HTTPS──▶ Next.js (Vercel) ──websocket+JWT──▶  Convex
  (UI only;         proxy.ts attaches                    ├─ queries/mutations (authz wrappers)
   no authz)        Clerk session only;                  ├─ outbox + scheduler (retries)
                    layouts redirect (UX)                ├─ crons (expiry, heartbeat check)
                                                         └─ httpActions /n8n/*, /clerk/webhook, /health
                                                              ▲                │
                                     HMAC n8n→Convex          │                │ HMAC Convex→n8n
                                     (CONVEX_INBOUND_SECRET)  │                ▼ (N8N_WEBHOOK_SECRET)
                                                         n8n (Railway / Docker local)
                                                          ├─ loan-notifications  (Webhook)
                                                          ├─ overdue-reminders   (Schedule, daily)
                                                          └─ error-handler       (Error Trigger)
                                                                │ SMTP
                                                                ▼
                                                     Mailpit (local) / SMTP provider (prod)
```

**Principle:** Convex is the only enforcement point. Next.js and n8n never decide permissions. n8n has no database access; it reaches Convex only through three signed, narrowly scoped endpoints.

### Repository layout

Single package (no monorepo):

```
app/                 App Router routes (see §9)
components/          UI components (shadcn-based, customized)
convex/
  schema.ts
  model/             pure domain logic, no Convex imports: loanMachine.ts, overlap.ts, dates.ts
  lib/               functions.ts (authz wrappers), hmac.ts, audit.ts, logger.ts, errors.ts, displayName.ts
  tools.ts loans.ts users.ts admin.ts
  automation/        outbox.ts, delivery.ts, payloads.ts, contract.ts, reminders.ts, heartbeat.ts, errors.ts
  http.ts            httpAction router
  crons.ts
  convex.config.ts   components (rate limiter)
contracts/           hmac-vectors.json (shared by Convex and n8n tests)
n8n/
  Dockerfile
  entrypoint.sh      render templates, import credentials + workflows, activate, start
  workflows/         loan-notifications.json, overdue-reminders.json, error-handler.json
docs/                see §13
design/              directions.html (UI direction mockup)
e2e/                 Playwright specs
scripts/             setup.ts (secret generation, env wiring), authz-matrix.ts
docker-compose.yml   n8n + Postgres + Mailpit
```

### Runtime topology

| Environment | Next.js | Convex | n8n | Mail |
|---|---|---|---|---|
| Local | `pnpm dev` on host, port 3000 | local deployment on host (`npx convex dev`), API 3210, HTTP actions 3211 | compose, port 5678 | Mailpit, UI 8025, SMTP 1025 |
| Demo | Vercel | Convex cloud (prod deployment) | Railway (our image + Railway Postgres) | SMTP provider (Resend with own domain or Gmail app password; open item) |

Local wiring: Convex reaches n8n at `http://localhost:5678`; n8n (in Docker) reaches Convex at `http://host.docker.internal:3211` (`extra_hosts: host-gateway`).

## 4. Data model

Rule: **outbox, audit and logs reference IDs, never personal data.**

```ts
users
  tokenIdentifier: string            // from Clerk identity
  clerkId: string
  name: string                       // full name, never sent anywhere whole
  email: string | null
  isTrustedLender: boolean
  trustedAt?: number, trustedBy?: Id<"users">
  deletedAt?: number                 // Clerk user.deleted → anonymized ("Former neighbour", email null)
  idx: by_token, by_clerkId
  // role is NOT stored: it comes from the token on every request

tools
  ownerId: Id<"users">
  name: string                       // 3–60 chars, trimmed
  category: Category
  condition: Condition
  description: string                // ≤ 500 chars
  status: "listed" | "removed"
  removedAt?: number, removedBy?: Id<"users">, removalReason?: string (≤ 200)
  updatedAt: number
  idx: by_status_category, by_owner
  // soft delete keeps loan history intact

loans
  toolId: Id<"tools">
  ownerId: Id<"users">               // denormalized for the incoming inbox
  borrowerId: Id<"users">
  startDate: string, endDate: string // "YYYY-MM-DD", endDate inclusive
  message?: string                   // ≤ 300, visible to owner only, never sent to n8n
  status: "pending" | "approved" | "active" | "returned" | "declined" | "cancelled" | "expired"
  closeReason?: "owner_declined" | "dates_taken" | "listing_removed" | "borrower_cancelled"
              | "owner_cancelled" | "account_deleted" | "not_handed_over" | "start_passed"
  approvedAt?, handedOverAt?, returnedAt?, closedAt?: number
  idx: by_tool_status, by_borrower_status, by_owner_status, by_status_endDate, by_status_startDate

outboxEvents
  type: EventType, schemaVersion: 1
  loanId?: Id<"loans">, toolId?: Id<"tools">
  recipientId: Id<"users">           // one event per recipient
  status: "pending" | "retrying" | "delivered" | "sent" | "failed" | "dead" | "skipped"
  attempts: number, nextAttemptAt?: number
  lastError?: string                 // sanitized, ≤ 300 chars
  deliveredAt?, sentAt?: number
  replayOf?: Id<"outboxEvents">
  idx: by_status, by_loan

reminders
  loanId: Id<"loans">
  idempotencyKey: string             // "<loanId>:<YYYY-MM-DD>"
  status: "sent" | "failed"
  n8nExecutionId: string
  error?: string                     // sanitized
  idx: by_idempotencyKey, by_loan

automationErrors
  workflow: string, executionId: string (dedupe key), node?: string
  message: string                    // sanitized, ≤ 500
  eventId?: Id<"outboxEvents">
  resolvedAt?: number, resolvedBy?: Id<"users">
  idx: by_executionId, by_resolved

automationHeartbeats
  workflow: "overdue-reminders", lastCheckInAt: number
  idx: by_workflow

auditLog                             // append-only: no update or delete function exists
  actorId?: Id<"users">, actorType: "user" | "admin" | "system" | "n8n"
  action: string                     // e.g. "loan.approve", "tool.remove", "user.trust"
  entityType: "loan" | "tool" | "user" | "outboxEvent" | "automationError"
  entityId: string
  fromStatus?: string, toStatus?: string, reason?: string
  at: number
  idx: by_entity, by_time
```

**Enums.** Categories: `power_tools, hand_tools, garden, kitchen, camping, cleaning, ladders, other`. Conditions: `new, like_new, good, fair`.

**Derived values (never stored):**
- `overdue` = `status === "active" && today(APP_TIMEZONE) > endDate`.
- Tool availability: *Available*, *On loan* (an `active` loan exists; shows "Back <endDate>"), plus upcoming booked ranges for the calendar. Other neighbours never see that someone else's loan is overdue.
- Display name for other users: first name + last initial ("Marta R."). Public pages show no user data at all.

**Dates.** Stored as `YYYY-MM-DD`. "Today" is computed in `APP_TIMEZONE` (Convex env var, default `UTC`) with `Intl.DateTimeFormat`. No timestamps are used for day comparisons.

**Account deletion (`user.deleted`).** Anonymize the user row, remove their listings, cancel their pending and approved loans (notify the counterparty), leave active loans for the counterparty to close.

## 5. Loan lifecycle

The state machine lives in `convex/model/loanMachine.ts` as a pure table `(status, action, actor) → nextStatus`. Every loan mutation goes through `applyLoanTransition(ctx, loan, action, extra)`, which in one transaction: validates the transition, patches the loan, writes the audit entry, and enqueues outbox events. It is not possible to change a loan's status without leaving an audit entry and an event.

| Action | Actor | From → to | Extra rules |
|---|---|---|---|
| `request` | borrower ≠ owner | — → pending | tool `listed`; `startDate ≥ today`; `endDate ≥ startDate`; range ≤ 30 days; no overlap with an `approved` or `active` loan; max one `pending` per borrower per tool; rate-limited |
| `approve` | owner | pending → approved | re-check overlap; auto-decline overlapping `pending` (`dates_taken`) |
| `decline` | owner | pending → declined | `owner_declined` |
| `cancel` | borrower | pending, approved → cancelled | `borrower_cancelled` |
| `cancel` | owner | approved → cancelled | `owner_cancelled` |
| `handOver` | owner | approved → active | `today ≤ endDate`; no other `active` loan for the tool (invariant: at most one active loan per tool) |
| `markReturned` | owner | active → returned | owner confirms receipt; the borrower cannot self-declare a return |
| `expire` | system (hourly cron) | pending → expired | `startDate < today` (`start_passed`) |
| `expire` | system (hourly cron) | approved → expired | `endDate < today` (`not_handed_over`) |
| (listing removed) | owner/admin | pending, approved → cancelled | `listing_removed` |

Concurrency: Convex mutations are serializable (OCC). Two racing approvals for overlapping ranges cannot both succeed; the loser retries, sees the conflict, and fails with `CONFLICT`.

## 6. Authorization

### Wrappers (`convex/lib/functions.ts`)

This is the only file allowed to import raw `query` / `mutation` / `action` from `_generated/server`. ESLint `no-restricted-imports` enforces it elsewhere, and a test scans `convex/` exports to confirm.

| Wrapper | Requires | Injects |
|---|---|---|
| `publicQuery` | nothing; explicit allowlist (only `tools.listPublic`) | — |
| `userQuery` / `userMutation` | valid JWT and a non-deleted `users` row | `ctx.user`, `ctx.role` |
| `adminQuery` / `adminMutation` | `role === "admin"` | same |
| `internal*` | scheduler, crons, httpActions only | — |

- Role parsing: `claim === "admin" ? "admin" : "user"`. Unknown or missing values get least privilege.
- Typed errors: `ConvexError({ code })` with `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | INVALID | RATE_LIMITED`.
- A resource the caller may not see returns `NOT_FOUND`, not `FORBIDDEN`, to prevent ID enumeration.
- Admins see everything, moderate listings and mark Trusted Lenders, but **cannot approve, decline, hand over or return other people's loans**. Least privilege applies to admins too.
- Admin user listings show display name and a masked email (`m***@example.com`).

### Function surface

| Module | Function | Access |
|---|---|---|
| `tools` | `listPublic` | public: available tools, server projection `{_id, name, category}` |
| | `browse({category?, availableOnly?, search?})` | user: listed tools + availability + owner display name + Trusted badge |
| | `get(toolId)` | user: details + booked ranges (dates only, no borrower identity) |
| | `mine` | user |
| | `create`, `update`, `remove` | user, owner only. `remove` blocked while a loan is `active`; cancels pending/approved |
| `loans` | `request`, `approve`, `decline`, `cancel`, `handOver`, `markReturned` | per §5 |
| | `myRequests`, `incoming` | user |
| | `timeline(loanId)` | loan parties and admin |
| `users` | `syncMe` | user: upsert from token claims |
| `admin` | `listLoans({status?, overdueOnly?})`, `listTools`, `listUsers` | admin |
| | `removeTool({toolId, reason})`, `setTrustedLender({userId, trusted})` | admin |
| | `auditLog({entityType?, entityId?})` | admin |
| | `automationHealth`, `replayEvent(eventId)`, `resolveError(errorId)` | admin |

`docs/authz-matrix.md` is generated from the authorization tests (§10), not written by hand.

## 7. Automation and integration

### 7.1 Outbox (Convex → n8n)

**Enqueue** (inside `applyLoanTransition`, same transaction): insert into `outboxEvents`, then `ctx.scheduler.runAfter(0, internal.automation.delivery.deliver, { eventId })`. Scheduling from a mutation is atomic with its commit: no commit, no event; commit, guaranteed attempt.

**`deliver` (internalAction):**
1. `claim` mutation: exit if status is not `pending` or `retrying` (prevents concurrent double sends); increment `attempts`.
2. `buildPayload` query assembles the payload now. Deleted recipient → `skipped`.
3. Sign and POST to `N8N_WEBHOOK_URL`, 10 s timeout.
4. Outcome:
   - 2xx → `delivered`.
   - 5xx, 408, 429, network error or timeout → `retrying` with backoff 30 s, 2 min, 10 min, 1 h, 6 h; after 5 attempts → `dead` (admin alert).
   - Any other 4xx (for example a rejected signature, meaning broken configuration) → `dead` immediately, no retry.

**Write-back from n8n:** after the email is sent, n8n calls `POST /n8n/notifications/status` → `sent`. On final failure the error workflow reports → `failed`.

**Replay:** an admin replay creates a **new** event with `replayOf` set. It is an explicit new intent, so it does not collide with n8n's dedupe of the original event ID.

Statuses: `pending → delivered → sent`, `retrying → dead`, `failed`, `skipped`. The timeline distinguishes "Queued" from a confirmed "Email sent".

### 7.2 Signing scheme

```
X-LendLoop-Timestamp: <unix seconds>
X-LendLoop-Signature: v1=<hex HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${rawBody}`)>
X-LendLoop-Event-Id: <outbox event id>          (Convex → n8n only)
```

- Binding method and path means a captured signature cannot be replayed against another endpoint.
- Window: |now − ts| ≤ 300 s.
- Convex verifies with `crypto.subtle.verify` (constant time). n8n compares in a Code node with a hand-written constant-time loop (no `crypto` builtin allowlist needed); the expected HMAC comes from the Crypto node using a Crypto credential.
- Rotation: verifiers accept `<SECRET>` and `<SECRET>_PREVIOUS`; signers use the current secret only. The rotation procedure is in `docs/runbook.md`.
- Secrets are at least 32 random bytes (`openssl rand -hex 32`).

### 7.3 Payload contract v1

```json
{
  "schemaVersion": 1,
  "eventId": "…",
  "type": "loan.approved",
  "occurredAt": "2026-11-06T11:02:00Z",
  "recipient": { "email": "ana@example.com", "firstName": "Ana" },
  "tool": { "name": "Cordless drill" },
  "loan": { "id": "…", "status": "approved", "startDate": "2026-11-08", "endDate": "2026-11-12" },
  "counterpartFirstName": "Marta",
  "actionUrl": "https://…/me/requests"
}
```

Never included: last names, the counterpart's email, the borrower's message, tool descriptions, internal user IDs. A unit test fails if the builder emits any key outside this allowlist.

| Event type | Recipient |
|---|---|
| `loan.requested` | owner |
| `loan.approved`, `loan.declined`, `loan.handed_over`, `loan.returned` | borrower |
| `loan.cancelled` | the other party |
| `loan.expired` | borrower (and owner if it was approved) |
| `listing.removed` | owner, plus each affected borrower |

### 7.4 n8n workflows

All three are exported to `n8n/workflows/` with credential references only and `{{PLACEHOLDER}}` tokens for non-secret config (`CONVEX_SITE_URL`, `APP_URL`, `MAIL_FROM`, `OPS_EMAIL`), rendered by `entrypoint.sh` before import.

**`loan-notifications`**

```
Webhook (POST, Raw Body, respond via "Respond to Webhook")
 → Crypto (HMAC SHA256, Crypto credential "LendLoop Convex→n8n")
 → Code: constant-time compare + timestamp window
    ├─ invalid → Respond 401 (generic body)
    └─ valid → Remove Duplicates ("Remove Items Processed in Previous Executions", key eventId, scope workflow)
                ├─ duplicate → Respond 200 {duplicate:true}
                └─ new → Respond 202 → Switch(type) → Send Email (SMTP credential, Retry On Fail 5×)
                                           → sign → POST /n8n/notifications/status {eventId, status:"sent"} (Retry 3×)
```

Why 202 before sending: if n8n deduplicated and then failed to send, Convex's retry would be dropped as a duplicate and the email silently lost. Accepting after verify + dedupe makes n8n the owner of the send; success is written back, final failure goes through the error workflow.

**`overdue-reminders`** (Schedule Trigger, daily 09:00, `GENERIC_TIMEZONE`)

```
Schedule → sign → GET /n8n/overdue-loans (Retry 3×)
 → Split Out → per loan: Send Email (Retry 5×, error output continues)
     → status sent|failed → sign → POST /n8n/reminders (Retry 3×)
```

**`error-handler`** (Error Trigger; set as the error workflow of the other two)

```
Error Trigger → Code: sanitize (workflow, executionId, node, truncated message, strip emails)
 → sign → POST /n8n/automation-errors (Retry 3×)
 → on failure: Send Email to OPS_EMAIL (last resort)
```

### 7.5 Convex HTTP endpoints

| Method + path | Caller | Auth | Behaviour | Idempotency |
|---|---|---|---|---|
| `GET /n8n/overdue-loans` | n8n | HMAC (inbound secret) | Records heartbeat check-in. Returns ≤ 200 active loans with `endDate < today` and no `sent` reminder today: `{loanId, idempotencyKey, borrower:{email, firstName}, tool:{name}, endDate, daysOverdue}` | read; re-running the same day returns nothing already reminded |
| `POST /n8n/reminders` | n8n | HMAC | `recordReminder` | by `idempotencyKey`; only `failed → sent` upgrades allowed; Convex re-validates that the key equals `loanId:today` and the loan is still overdue |
| `POST /n8n/notifications/status` | n8n | HMAC | outbox `pending`/`retrying`/`delivered` → `sent` (the write-back can race ahead of Convex recording `delivered`; `markDelivered` never downgrades `sent` or `failed`) | setting the same status twice is a no-op |
| `POST /n8n/automation-errors` | n8n | HMAC | insert `automationErrors`; with `eventId` marks the outbox event `failed` | by `executionId` |
| `POST /clerk/webhook` | Clerk | Svix (`svix` `Webhook.verify`) | `user.updated`, `user.deleted` | handlers are naturally idempotent (upsert, anonymize); delivery is at-least-once and unordered, so `user.updated` is ignored for already-deleted users |
| `GET /health` | uptime monitor | none | `{ok:true}`, no data | — |

All inbound endpoints: body ≤ 64 KB (413 otherwise), strict `Content-Type`, Convex validators on the parsed body, generic error bodies (`401`, `400`) with no detail, structured logs with redaction, global token-bucket rate limit.

### 7.6 Failure modes

| Failure | Detection | Outcome |
|---|---|---|
| n8n down or slow | non-2xx or timeout on delivery | `retrying` with backoff → `dead` after 5; admin panel alert; manual replay |
| Signature misconfigured | n8n returns 401 | `dead` immediately (no retry storm); panel shows config error |
| SMTP fails | Send Email retries exhausted | error workflow → `/n8n/automation-errors` → event `failed`; replay available |
| Convex unreachable from error workflow | HTTP retries exhausted | fallback email to `OPS_EMAIL` |
| Duplicate delivery (Convex retried after a timeout n8n actually processed) | Remove Duplicates on `eventId` | 200 `{duplicate:true}`; no second email |
| Reminder write-back retried | `idempotencyKey` | no duplicate row |
| Reminder workflow re-run the same day | GET excludes loans with a `sent` reminder today | no duplicate email |
| Cron never runs (n8n stopped, workflow deactivated) | Convex cron checks heartbeat hourly; last check-in > 26 h | admin panel alert ("Reminders stale") |
| Replayed or forged request | timestamp window + HMAC + method/path binding | 401 |

## 8. Security and privacy

### Secrets

| Secret | Lives in | Used for |
|---|---|---|
| `N8N_WEBHOOK_SECRET` (+ `_PREVIOUS`) | Convex env; n8n Crypto credential | Convex → n8n signatures |
| `CONVEX_INBOUND_SECRET` (+ `_PREVIOUS`) | Convex env; n8n Crypto credential | n8n → Convex signatures |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Convex env | Svix verification |
| `CLERK_SECRET_KEY` | Vercel env / `.env.local` | Next.js server |
| SMTP credentials | n8n SMTP credential | email |
| `N8N_ENCRYPTION_KEY`, Postgres password | Railway variables / local `.env` (gitignored) | n8n |
| `CONVEX_DEPLOY_KEY` | Vercel env | build-time deploy |

n8n credentials are provisioned by `entrypoint.sh`: it writes a temporary credentials JSON from environment variables, runs `n8n import:credentials`, and deletes the file. The repo and exported workflow JSON contain only credential names and IDs.

### Hardening

- **n8n:** `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_SAVE_ON_ERROR=all`, `EXECUTIONS_DATA_MAX_AGE=168`, `EXECUTIONS_DATA_PRUNE=true`, diagnostics off, Postgres backend, pinned image version, owner account claimed before the instance is exposed.
- **Next.js:** security headers via `next.config` (CSP allowing Clerk and Convex origins, HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors 'none'`). `proxy.ts` runs `clerkMiddleware()` with no route rules (Clerk deprecated `createRouteMatcher` in favour of resource-level checks); app layouts call `auth.protect()` for UX redirects only.
- **Convex:** all validation server-side with Convex validators (lengths, enums, trimming); rate limits via `@convex-dev/rate-limiter` (`loans.request` 10/hour/user, `tools.create` 20/day/user, inbound HTTP endpoints global token bucket).
- **Logging:** `logger.ts` emits structured JSON and redacts `email`, `name`, `message` keys and email-shaped strings. Payload bodies are never logged.
- **Audit:** every state transition and admin action writes to the append-only `auditLog`; no function updates or deletes it.

### Data minimization (summary; full table in `docs/pii-map.md`)

| Field | Stored | Shown to | Sent to n8n | Retention |
|---|---|---|---|---|
| Email | `users` | nobody else (admin sees masked) | recipient's own, at send time | until account deletion |
| Name | `users` | others see first name + last initial | first name only | until account deletion |
| Borrower message | `loans` | tool owner | never | with the loan |
| Loan dates | `loans` | parties, admin; others see booked ranges without identity | yes (own loans) | with the loan |
| n8n execution data | n8n Postgres | n8n owner | — | success: not stored; errors: 7 days |

## 9. UI and UX

Direction: **B · Ledger** (reference mockup `design/directions.html`, tab B).

### System

- Tokens in OKLCH → Tailwind v4 `@theme` + shadcn CSS variables; shadcn components are always customized, never shipped in default state.
- Light and **dark mode** (near-black cool neutral, lightened cobalt); follows `prefers-color-scheme` with a manual toggle.
- Type: IBM Plex Sans (display 600 with −0.04em tracking; UI 400/500) and IBM Plex Mono (IDs, dates, counts, `kbd`), loaded via `next/font`.
- Radii: buttons 8, cards 10, badges 6. 1 px hairlines; shadows only on popovers and dialogs.
- Accent: cobalt, button fill tuned to pass WCAG AA with white text. One accent, used everywhere.
- Icons: Phosphor (replacing shadcn's default lucide).
- Warmth comes from copy and first names, not palette. UI copy is plain and functional, with no em dashes.

### Libraries

shadcn/ui (Button, Dialog, Popover, Calendar on react-day-picker, Command, Tabs, Table, Tooltip, Sheet, Skeleton, Badge, Form), Sonner, `motion` (`motion/react`), Magic UI `NumberTicker` and `BlurFade`, Paper Shaders `Dithering` (`@paper-design/shaders-react`, version pinned, client-only), Phosphor icons. Optionally an adapted stateful button pattern from Aceternity.

### Screens

| Route | Content |
|---|---|
| `/` (public) | Left-aligned hero with `Sign in to lend or borrow [S]` · Dithering band · live register of available tools (No. / Tool / Category) via `preloadQuery` · "How it works" as ledger rows · "How we handle your data" block (owners private, email only for loan updates, every action audited) · hairline mono footer |
| App shell | Desktop sidebar rail (Browse, My listings, My requests, Incoming with count, Admin when admin) · mobile drawer · `⌘K` palette (navigate, search tools) · `N` new listing · Clerk `UserButton` |
| `/tools` | Toolbar: search, category filter in URL (`?category=`), "Available only" toggle · dense grid: mono No., name, category, condition, owner display name + Trusted badge, availability badge |
| `/tools/new`, `/tools/[id]/edit` | Form with labels above inputs, inline errors below, character counters |
| `/tools/[id]` | Details · range calendar (2 months desktop, 1 mobile; booked days struck through, legend, reason on focus/hover) · day-count summary · optional message (300) · stateful request button. Owners see edit controls and the tool's loans instead |
| `/me/listings`, `/me/requests` | Tables with status badges and actions; delete disabled with reason while a loan is active |
| `/me/incoming` | Tabs *Needs action (n) / Upcoming / Active / Past* · Approve, Decline, Hand over, Mark returned · inline overlap warning ("Approving Ana declines 1 overlapping request") |
| `/loans/[id]` | Timeline: transitions + automation events, relative time with absolute on hover, next expected step dashed |
| `/admin` | Stat tiles (NumberTicker): active, overdue, pending events, dead letters, reminder heartbeat · tabs Loans, Listings (remove with reason), Users (Trusted toggle), Automation (outbox with replay, errors with resolve), Audit log |

Status badges always carry text (never colour alone): Requested, Approved, Handed over, Returned, Declined, Cancelled, Expired, and Overdue as the only loud state.

States: skeletons shaped like the final layout while `useQuery` is `undefined`; empty states with an action; `ConvexError` codes mapped to human messages in Sonner toasts. Confirmation only for actions with side effects (approve that auto-declines others, removals); everything else acts immediately.

### Motion

| Interaction | Motion | Reason |
|---|---|---|
| `⌘K`, shortcuts, keyboard navigation | none | high-frequency actions |
| Button press | `scale(0.97)`, 140 ms, `--ease-out` | tactile feedback |
| Row hover | colour, 120 ms, only under `(hover: hover) and (pointer: fine)` | no false hover on touch |
| Popover, menu, calendar | 160 ms opacity + `scale(0.97 → 1)`, origin at trigger | origin-aware |
| Dialog | 200 ms, centred | not anchored |
| New realtime row | 200 ms opacity + `translateY(4px)` | realtime change without a jump |
| Status change | crossfade with 2 px blur, 180 ms | bridges two states |
| Landing first paint | BlurFade, 40 ms stagger, once | hierarchy |
| Dithering band | `speed 0.25`, paused off-screen, static (`speed 0`) under reduced motion | GPU cost |

Easings: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Nothing over 300 ms. Reduced motion keeps opacity, drops movement.

### Accessibility

WCAG AA contrast in both themes; instant 2 px cobalt focus ring; keyboard-navigable calendar with per-day `aria-label` ("Nov 18, unavailable"); heading levels never skip; axe checks in E2E.

## 10. Testing

| Layer | Coverage |
|---|---|
| Unit (vitest, pure `convex/model` and `convex/lib`) | state machine (table-driven) · overlap · dates and timezone boundaries · HMAC (vectors, window, rotation, tampering) · log redaction · payload allowlist |
| Convex integration (`convex-test`, edge-runtime) | authorization matrix: every public function × {anonymous, owner, other user, admin} · transitions write audit + outbox · auto-decline · delivery with mocked `fetch` (2xx, 5xx backoff, 4xx dead, timeout) · reminder idempotency · HTTP endpoints (bad or stale signature → 401, oversize → 413) · Clerk webhook · expiry cron · heartbeat staleness |
| Contract | `contracts/hmac-vectors.json` consumed by the Convex tests **and** by a test that extracts the verification Code node's `jsCode` from the exported workflow JSON and runs it against the same vectors |
| Workflow lint | exported JSON: no credential data or secret-like strings, error workflow assigned, Retry On Fail on HTTP and email nodes, Raw Body on the webhook |
| Static | ESLint `no-restricted-imports` + a test scanning `convex/` exports for wrapper use |
| E2E (Playwright, local) | list → request → approve → email arrives in Mailpit via n8n · public page exposes no owner data · role-gated UI · axe. Uses Clerk testing tokens |

## 11. CI (GitHub Actions)

Typecheck, lint, unit + `convex-test`, workflow lint, gitleaks, `next build`, and a check that `docs/authz-matrix.md` matches the generated output. E2E runs locally (it needs the full stack and a Clerk instance); the README documents how.

## 12. Local setup and deployment

### Local

1. `pnpm install`
2. `pnpm setup:local` (not `pnpm setup`, which is a pnpm built-in): generates secrets, writes `n8n/.env` (gitignored, mode 0600), sets Convex env vars with `npx convex env set`.
3. `docker compose up -d`: n8n (our image, workflows and credentials imported and activated), Postgres, Mailpit.
4. `pnpm dev`: Next.js + Convex local deployment.
5. `pnpm seed`: fictional neighbours, tools, and one overdue loan.

Clerk prerequisites (documented step by step): create an application, activate the Convex integration, add session-token claims `role`, `email`, `name`, and optionally configure the webhook (production only; local dev does not depend on it).

### Environment variables

| Where | Variables |
|---|---|
| Next.js | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CONVEX_DEPLOY_KEY` (Vercel build) |
| Convex | `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `N8N_WEBHOOK_SECRET_PREVIOUS`, `CONVEX_INBOUND_SECRET`, `CONVEX_INBOUND_SECRET_PREVIOUS`, `APP_URL`, `APP_TIMEZONE` |
| n8n container | `N8N_ENCRYPTION_KEY`, `DB_POSTGRESDB_*`, `GENERIC_TIMEZONE`, `LENDLOOP_N8N_WEBHOOK_SECRET`, `LENDLOOP_CONVEX_INBOUND_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `CONVEX_SITE_URL`, `APP_URL`, `MAIL_FROM`, `OPS_EMAIL`, plus the hardening variables in §8 |

### Demo deployment

- Vercel for Next.js; build runs `npx convex deploy` against the Convex prod deployment.
- Clerk development instance (a production instance requires an owned domain; noted in `docs/production.md`).
- Railway: `n8n/Dockerfile` + Railway Postgres; variables set in Railway.
- Demo admin account: Clerk user with `publicMetadata.role = "admin"`. Credentials go in the submission email, never in the repo.

## 13. Documentation deliverables

- `README.md`: what it is, screenshots/GIF, quickstart, env var table, mermaid architecture diagram, security and data-minimization summary with links, production note.
- `docs/architecture.md`: components and sequence diagrams for both workflows.
- `docs/security.md`: STRIDE-lite threat model mapped to code.
- `docs/authz-matrix.md`: generated from tests.
- `docs/pii-map.md`: every personal field, where it lives, who sees it, retention.
- `docs/integration.md`: contract, signing, retries, idempotency, failure-mode table.
- `docs/adr/`: one short record per decision in §2.
- `docs/runbook.md`: replay dead letters, rotate secrets, respond to a stale heartbeat.
- `docs/production.md`: see §14.

## 14. Production note (summary)

Clerk production instance with an owned domain; a secret manager with scheduled rotation; n8n queue mode with workers and database backups; Convex log streams to a log drain, Sentry, and an uptime monitor alerting on the reminder heartbeat; SPF, DKIM and DMARC for the sending domain; retention and purge policies for audit, reminders and n8n data; data export and deletion flows; nonce-based CSP; external penetration test; neighbourhood tenancy.

## 15. Risks and day-one spikes

| Spike | Fallback |
|---|---|
| Convex local deployment can `fetch` `http://localhost:5678` **Result 2026-10-31: works (both `localhost` and `127.0.0.1` return 200)** | run Convex self-hosted inside the compose network |
| n8n 2.x: Crypto node HMAC over the Raw Body; Code node constant-time compare without builtins; CLI activation of imported workflows; credential import from generated JSON; `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` breaks nothing; Remove Duplicates with workflow scope **Result 2026-10-31 (n8n 2.45.7, internal JS task runner): works.** Raw body: Webhook 2.1 `options.rawBody` emits the exact request bytes as inline base64 binary `data`; a Code node reads them with `await this.helpers.getBinaryDataBuffer(0, 'data')` (kept: also handles filesystem binary mode; `Buffer.from(binary.data.data, 'base64')` works too). Crypto v2 HMAC over that string equals node:crypto for a UTF-8 body (`Taladro ñandú`). Credentials: `import:credentials --input=<array file>` takes `{id, name, type, data}` with a plaintext `data` object and encrypts it (`encryptV2`; Postgres holds ciphertext, export shows 0 `hmacSecret`); fixed IDs upsert on every start. Activation: `import:workflow` imports inactive; `publish:workflow --id` before `n8n start` activates. `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`: `$env` throws "access to env vars denied"; nothing else affected. Owner from env (bcryptjs hash, `$` doubled because compose interpolates env files) logs in; failed CLI commands exit 1, so the entrypoint fails fast. Mailpit pinned to `axllent/mailpit:v1.33.0`. Remove Duplicates v2 (scope workflow) persists keys in Postgres (`processed_data`, survives restarts); it declares one output, so the duplicate branch is `alwaysOutputData` + an IF on the event ID. `n8n execute --id` starts only from a Manual/Execute Workflow Trigger (overdue-reminders has a "Run now" Manual Trigger) and, inside the running container, needs `N8N_RUNNERS_BROKER_PORT` set to a free port. **E2E 2026-10-31 (`pnpm e2e:automation`, all PASS, also on a same-day re-run):** email on request and write-back `sent`; repeated event ID → 200 `{duplicate:true}` and no second email; forged signature → 401; overdue reminder sent and recorded once, second run sends nothing, heartbeat fresh; SMTP failing (Mailpit chaos: every recipient rejected with 451) → Send email error output reports with the event ID (address scrubbed) and Convex marks the event `failed`; admin replay delivers once SMTP works. Stopping the Mailpit container instead is timing-dependent: each attempt waits on network timeouts and one run's last retry succeeded once Mailpit was back. Error workflow → `/n8n/automation-errors` and the `OPS_EMAIL` fallback (Convex stopped) verified manually. | Code node with `crypto` builtin allowlisted on task runners; REST API for activation |
| Claiming the n8n owner account before a public instance is reachable | provision behind Railway private networking until the owner is set |
| Clerk session-token claims (`role`, `email`, `name`) arrive on `ctx.auth.getUserIdentity()` **Result 2026-10-31: works with the native Convex integration (`aud: convex`) plus custom claims; role change visible after a forced token refresh** | JWT template named `convex` with the same claims |
| Paper Shaders under Next.js 16 (client-only, dynamic import) | static CSS gradient band |
| Railway build and run of our n8n image with Postgres | Fly.io with the same image |

## 16. Open items

- SMTP provider for the demo (Resend with an owned domain, or a Gmail app password).
- Value of `APP_TIMEZONE` / `GENERIC_TIMEZONE` for the demo.
