# Security

How LendLoop protects its users' data, which threats it considers, and the file or test that proves each mitigation. Where something is not done, it is listed under [known limitations](#known-limitations) rather than implied.

Related: [authorization matrix](authz-matrix.md) (generated), [PII map](pii-map.md), [integration contract](integration.md), [production note](production.md).

## Principles

1. **One enforcement point.** Every permission decision happens in a Convex function. Next.js and n8n are untrusted for authorization.
2. **Least privilege, including admins.** Admins moderate listings and see automation health; they cannot approve, decline, hand over or return other people's loans.
3. **Collect little, show less, send less.** Other neighbours see "Marta R.", never a full name or email. n8n receives the recipient's own email and first names only, built at send time.
4. **Every change leaves a trace.** Loan transitions and admin actions write to an append-only audit log in the same transaction.
5. **Secrets never travel through git, argv or logs.**

## Threat model (STRIDE-lite)

| # | Threat | Mitigation | Proof (file / test) |
|---|---|---|---|
| S1 | Calling Convex as someone else (forged or foreign JWT) | Convex verifies the Clerk JWT against `CLERK_JWT_ISSUER_DOMAIN` and `applicationID: "convex"` (the `aud` claim). Wrappers require a valid identity and a non-deleted `users` row. | `convex/auth.config.ts`, `convex/lib/functions.ts`; `convex/users.test.ts` "syncMe requires a token", "me before syncMe, or after deletion, is unauthenticated"; every `anonymous` cell in [authz-matrix.md](authz-matrix.md) |
| S2 | Granting yourself admin | Role comes only from the `role` claim, filled from Clerk `publicMetadata` (backend-writable; never `unsafeMetadata`). It is read from the token on every call and never stored. Anything other than `"admin"` is `user`. | `parseRole` in `convex/lib/functions.ts`; `users.test.ts` "unknown role claims get least privilege"; admin rows of the matrix |
| S3 | Impersonating n8n to Convex | HMAC-SHA256 over `ts.METHOD.path.body` with `CONVEX_INBOUND_SECRET`, 300 s window, constant-time verify | `convex/lib/hmac.ts`, `convex/automation/inbound.ts`; `convex/http.test.ts` "unsigned, wrong-secret and stale requests get a bare 401"; `convex/lib/hmac.test.ts` |
| S4 | Impersonating Convex to n8n (sending email through LendLoop) | Same scheme with a **separate** secret (`N8N_WEBHOOK_SECRET`), verified in the `Verify signature` Code node with a constant-time loop | `n8n/workflows/loan-notifications.json`; `tests/n8n/contract.test.ts` "rejects: …"; `pnpm e2e:automation` "forged signature is rejected" |
| S5 | Forged Clerk webhook (delete or rename an account) | Svix signature verification (`svix` `Webhook.verify`, which also checks the timestamp) | `convex/clerkWebhook.ts`; `convex/clerkWebhook.test.ts` "rejects bad signatures" |
| S6 | Claiming a fresh n8n instance before its owner | Owner account provisioned from env (`N8N_INSTANCE_OWNER_MANAGED_BY_ENV`, bcrypt hash), so a public instance is never claimable; the plain password never enters the container | `docker-compose.yml`, `scripts/setup.ts` |
| T1 | Tampering with a signed request (body, path or method) | All four are inside the signed string | `hmac.test.ts` "rejects a tampered body, path or method"; `http.test.ts` "a signature for one path can't be replayed on another" |
| T2 | Swapping the event ID to dodge dedupe | The (unsigned) `X-LendLoop-Event-Id` must equal the `eventId` in the signed body | `tests/n8n/contract.test.ts` "rejects: event-id header differs from the signed body" |
| T3 | Replaying a captured request | 300 s window; dedupe by event ID (n8n), idempotency key (reminders), execution ID (errors) | `hmac.test.ts` "rejects stale and future timestamps beyond 300 s"; `http.test.ts` "write-back is idempotent …"; e2e "repeated event ID is a duplicate" |
| T4 | Changing a loan's status without a trace | `applyLoanTransition` is the only path: transition table, patch, audit entry and outbox event in one transaction | `convex/lib/loanTransitions.ts`; `loanTransitions.test.ts` "approve patches, audits and enqueues in one go"; `convex/model/loanMachine.test.ts` |
| T5 | Invalid or oversized input | Convex validators on every argument, enums, trimmed lengths (tool name 3 to 60, description 500, message 300, removal reason 3 to 200), ISO dates, 30-day maximum, 64 KB HTTP bodies | `convex/lib/validators.ts`, `convex/lib/tools.ts`, `convex/model/dates.ts`; `tools.test.ts` "create rejects bad names"; `dates.test.ts` "checkRequestedRange"; `http.test.ts` "… oversize → 413; bad body → 400" |
| T6 | n8n writing reminders for arbitrary loans or days | Convex re-validates: key must be `<loanId>:<today>` for a real loan that is `active` or `returned` | `convex/automation/reminders.ts`; `http.test.ts` "rejects keys that are not today's key for that loan" |
| R1 | Denying an action ("I never approved that") | Append-only `auditLog` with actor, action, from/to status and reason; no function updates or deletes it | `convex/lib/audit.ts`; `loans.request.test.ts` "creates a pending loan, audits, and notifies the owner"; `admin.test.ts` "setTrustedLender toggles and audits" |
| R2 | Admin actions without accountability | Removals, trust changes, replays and error resolutions are audited with the admin's ID; removals need a reason | `convex/admin.ts`; `admin.test.ts` |
| I1 | Public landing page leaking neighbours | `tools.listPublic` projects `{_id, name, category}` for available tools only; it is the single public function | `convex/tools.ts`; `tools.test.ts` "anonymous callers get name and category only"; `tests/static/wrappers.test.ts` "publicQuery is used only by tools.listPublic"; Playwright: no owner names in the landing DOM |
| I2 | Learning that a loan exists (ID enumeration) | Callers who are not a party get `NOT_FOUND`, not `FORBIDDEN` | `convex/lib/loanAccess.ts`; `loans.request.test.ts` "only the owner may approve; strangers can't see the request"; `NOT_FOUND` cells in the matrix |
| I3 | Seeing who borrowed what | Tool calendars show booked ranges as dates only, never the borrower; the UI does not announce late returns (but see limitation 14) | `tools.ts` `get`; `tools.test.ts` "get shows booked ranges without borrower identity" |
| I4 | The borrower's message reaching others | Shown to the tool owner only (not to admins), never sent to n8n | `summarizeLoan` in `loanAccess.ts`; `loans.queries.test.ts` "… never the message to the borrower"; payload allowlist |
| I5 | Personal data in n8n | Payload allowlist, built at send time; deleted recipients are skipped | `convex/automation/payloads.ts`; `payloads.test.ts` "payload carries only allowlisted fields", "deleted recipients get no payload" |
| I6 | Personal data in logs and error messages | `redact()` masks `email`, `name`, `firstName`, `message`, `recipient`, `body` keys and email-shaped strings; stored errors are sanitized and truncated; n8n Code nodes strip emails before reporting | `convex/lib/logger.ts`; `logger.test.ts`; `tests/n8n/contract.test.ts` "Sanitize error: … without emails, truncated" |
| I7 | Secrets in the repo or exported workflows | n8n credentials hold secrets; workflow JSON has credential references and three placeholders only; gitleaks runs in CI | `tests/n8n/workflows.test.ts` "contains no secrets or credential data", "only allowlisted placeholders"; `.github/workflows/ci.yml` |
| I8 | A workflow reading the process env (n8n encryption key, DB password) | `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`; Code nodes use no builtins | `docker-compose.yml`; `workflows.test.ts` "Code nodes do not require node builtins"; spec §15 spike |
| I9 | Admins harvesting emails | Admin user list shows display name and masked email (`m***@example.com`) | `convex/admin.ts`, `maskEmail`; `admin.test.ts` "listUsers masks emails" |
| I10 | XSS impact, clickjacking, referrer leaks | CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production; React escapes output; plain-text emails | `next.config.ts` (see [CSP and headers](#csp-and-headers)) |
| D1 | Request or listing spam | Per-user token buckets: `loans.request` 10 per hour, `tools.create` 20 per day | `convex/lib/rateLimits.ts`; `loans.request.test.ts` "rate limited to 10 per hour"; `tools.test.ts` "create is rate limited to 20 per day" |
| D2 | Flooding the HTTP endpoints | Global token buckets (n8n endpoints 120 per minute, burst 240; Clerk webhook 60 per minute, burst 120); 64 KB cap before parsing | `rateLimits.ts`, `inbound.ts`, `clerkWebhook.ts` |
| D3 | Retry storm from a misconfiguration | Non-retryable 4xx (for example 401) goes straight to `dead`; at most 5 attempts otherwise | `convex/model/delivery.ts`; `delivery.test.ts` "a 401 … goes straight to dead" |
| E1 | A neighbour acting as the owner (approve, hand over, mark returned) | `loadLoanForParty` + `requireParty` on every loan mutation; the state machine binds actions to actors | `loanAccess.ts`, `loanMachine.ts`; `loans.lifecycle.test.ts` "borrower can't self-declare a return"; matrix |
| E2 | Admin overreach on loans | Admins are not parties, so loan actions return `NOT_FOUND` for them | admin column of the matrix |
| E3 | A function shipped without auth | Only `convex/lib/functions.ts` may import raw builders (ESLint `no-restricted-imports` plus a test); every public function must appear in the matrix | `eslint.config.mjs`; `tests/static/wrappers.test.ts`; `tests/static/authzCoverage.test.ts`; `convex/authz.test.ts` "every matrix row has an executable call and vice versa" |
| E4 | Wiping data with dev tools | `devtools:*` and `seed:*` are internal (deploy key only) and dev tools refuse unless `ALLOW_DEV_TOOLS=true`, which production never sets | `convex/devtools.ts`; `devtools.test.ts` "guard" |

## RBAC

Two roles, decided per request from the token:

| Role | Source | Can |
|---|---|---|
| `user` | default, or any `role` claim other than `"admin"` | list, edit and remove own tools; request tools; act on loans as owner or borrower per the state machine; see own requests, incoming requests and timelines of own loans |
| `admin` | `role: "admin"` claim from Clerk `publicMetadata` | everything a user can, plus: list all loans, tools and users (masked emails); remove any listing with a reason; mark Trusted Lenders; read the audit log; see automation health; replay failed notifications; resolve automation errors; read any loan's timeline |

Wrappers in [`convex/lib/functions.ts`](../convex/lib/functions.ts):

| Wrapper | Requires | Injects | Used by |
|---|---|---|---|
| `publicQuery` | nothing | nothing | `tools.listPublic` only (test-enforced) |
| `identityMutation` | valid JWT | `ctx.identity` | `users.syncMe` only, which creates the `users` row |
| `userQuery`, `userMutation` | valid JWT and a non-deleted `users` row | `ctx.user`, `ctx.role` | everything else a neighbour calls |
| `adminQuery`, `adminMutation` | as above and `role === "admin"` | same | `convex/admin.ts` |
| `internal*`, `httpAction` | not callable by clients | none | scheduler, crons, HTTP routes, `npx convex run` |

Resource checks sit on top: owner-only tool edits return `FORBIDDEN` to signed-in non-owners (the tool is visible to them anyway), while loan actions by non-parties return `NOT_FOUND`. Errors are typed `ConvexError({ code })` with `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | INVALID | RATE_LIMITED`, and the UI maps codes to plain messages.

**Making someone admin:** Clerk dashboard → Users → the user → Metadata → Public: `{"role": "admin"}`. Removing the key revokes it. Either change reaches Convex when the session token refreshes (Clerk session tokens live 60 seconds) or on the next sign-in. The full matrix of functions × actors is in [authz-matrix.md](authz-matrix.md), generated from `tests/authz/matrix.ts` and asserted by `convex/authz.test.ts`.

## Secrets

| Secret | Lives in | Generated by | Rotation |
|---|---|---|---|
| `N8N_WEBHOOK_SECRET` (+ `_PREVIOUS`) | Convex env; n8n credential "LendLoop: Convex→n8n HMAC" (and "(previous)") via `LENDLOOP_N8N_WEBHOOK_SECRET[_PREVIOUS]` | `pnpm setup:local` (32 random bytes) or `openssl rand -hex 32` | [runbook](runbook.md#rotate-the-hmac-secrets) |
| `CONVEX_INBOUND_SECRET` (+ `_PREVIOUS`) | Convex env; n8n credential "LendLoop: n8n→Convex HMAC" via `LENDLOOP_CONVEX_INBOUND_SECRET` | same | same |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Convex env (must start with `whsec_`) | Clerk dashboard | [runbook](runbook.md#other-secrets) |
| `CLERK_SECRET_KEY` | `.env.local`, Vercel env | Clerk dashboard | runbook |
| `CONVEX_DEPLOY_KEY` | Vercel env (build only) | Convex dashboard | runbook |
| SMTP password (Resend API key) | n8n credential "LendLoop SMTP" via `SMTP_PASS` | Resend (sending-only key for one domain) | runbook |
| `N8N_ENCRYPTION_KEY` | `n8n/.env` (mode 0600), Railway variables | `pnpm setup:local` | see runbook caveat |
| Postgres password | `n8n/.env`, Railway plugin | `pnpm setup:local`, Railway | Railway |
| n8n owner password | `n8n/.env` only; the container gets the bcrypt hash | `pnpm setup:local` | rerun setup after deleting it |

How they move:

- `pnpm setup:local` writes `n8n/.env` with mode 0600 and pushes Convex values through **stdin** to `convex env set`, never argv. It prints key names, never values.
- `n8n/entrypoint.sh` writes a temporary credentials file (mode 0600, inside a `mktemp -d` directory removed on exit), runs `n8n import:credentials` (n8n encrypts them with `N8N_ENCRYPTION_KEY`) and deletes the file. Secrets are read by `node` from env, so they never appear on a command line.
- Exported workflows reference credentials by fixed ID and name. Only `{{CONVEX_SITE_URL}}`, `{{MAIL_FROM}}` and `{{OPS_EMAIL}}` are rendered into them, JSON-escaped.
- Convex ignores HMAC secrets shorter than 32 characters and answers `503 not_configured` rather than accepting weak keys.
- CI runs gitleaks over the history; `.gitleaks.toml` allowlists only the test fixtures (the test secret in `contracts/hmac-vectors.json` and the fake `whsec_` in tests).

## Webhook signing

Summary (details in [integration.md](integration.md#signing)): HMAC-SHA256 over `timestamp.METHOD.path.rawBody`, `v1=` hex in `X-LendLoop-Signature`, 300-second window, constant-time comparison on both sides, separate secrets per direction so a leak of one cannot forge the other, and current-plus-previous verification for rotation. The same vectors (`contracts/hmac-vectors.json`) test Convex's implementation and the JavaScript extracted from the exported n8n workflow, so the two cannot drift apart unnoticed.

Clerk webhooks use Svix (`svix-id`, `svix-timestamp`, `svix-signature`). Delivery is at-least-once and unordered; `user.updated` never resurrects a deleted account.

## Rate limits

`@convex-dev/rate-limiter`, token buckets ([`convex/lib/rateLimits.ts`](../convex/lib/rateLimits.ts)):

| Limit | Rate | Burst | Key | On exceed |
|---|---|---|---|---|
| `loanRequest` | 10 per hour | 10 | user ID | `RATE_LIMITED` |
| `toolCreate` | 20 per day | 20 | user ID | `RATE_LIMITED` |
| `inboundHttp` | 120 per minute | 240 | global (`n8n`) | `429` |
| `clerkWebhook` | 60 per minute | 120 | global (`clerk`) | `429` |

Sign-in brute force and bot protection are Clerk's responsibility.

## CSP and headers

Set for every route in `next.config.ts` `headers()`. Origins are built from env (`NEXT_PUBLIC_CONVEX_URL`, and the Clerk Frontend API host decoded from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`), so the same config works locally and in production. It follows Clerk's CSP guide.

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'unsafe-inline'` + Clerk Frontend API + `https://challenges.cloudflare.com`; `connect-src 'self'` + Convex (`https` and `wss`) + Clerk; `img-src 'self' data: https://img.clerk.com`; `style-src 'self' 'unsafe-inline'`; `font-src 'self'`; `frame-src https://challenges.cloudflare.com`; `worker-src 'self' blob:`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'` |
| `Strict-Transport-Security` | production only |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `X-Frame-Options` | `DENY` |

`'unsafe-inline'` for scripts is the honest gap: it keeps the statically prerendered pages working without per-request nonces. The nonce-based policy is the production follow-up ([production.md](production.md#nonce-based-csp)).

## Logging and redaction

- `convex/lib/logger.ts` writes one JSON line per event (`outbox.delivered`, `outbox.retry`, `outbox.dead`, `inbound.rejected`, `heartbeat.stale`, `automation.error`, `clerk_webhook.rejected`, …).
- Before writing, `redact()` replaces the values of `email`, `name`, `firstName`, `message`, `recipient` and `body` keys with `[redacted]`, replaces email-shaped substrings anywhere with `[email]`, and truncates nesting past six levels. Payload bodies are never logged.
- Errors stored in the database (`lastError`, reminder `error`, `automationErrors.message`) go through `sanitizeError`: emails stripped, whitespace collapsed, 300 or 500 characters maximum.
- n8n keeps no data for successful executions (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`) and prunes error executions after 7 days.
- The automation E2E masks every email it prints.

## n8n hardening

Set in `docker-compose.yml` locally and as Railway variables in production (the image does not set them, so each must be present in the deployment):

| Variable | Value | Why |
|---|---|---|
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `true` | Workflows cannot read the encryption key or DB password |
| `EXECUTIONS_DATA_SAVE_ON_SUCCESS` | `none` | No copies of payloads (emails) for successful runs |
| `EXECUTIONS_DATA_SAVE_ON_ERROR` | `all` | Failed runs can be debugged |
| `EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_PRUNE` | `168`, `true` | Error executions deleted after 7 days |
| `N8N_DIAGNOSTICS_ENABLED`, `N8N_PERSONALIZATION_ENABLED`, `N8N_VERSION_NOTIFICATIONS_ENABLED`, `N8N_TEMPLATES_ENABLED` | `false` | No outbound telemetry or template calls |
| `N8N_PUBLIC_API_DISABLED` | `true` | No REST API surface |
| `N8N_INSTANCE_OWNER_MANAGED_BY_ENV` | `true` | Owner provisioned from env; never claimable |
| `N8N_SECURE_COOKIE` | `false` locally (plain HTTP), `true` in production | Session cookie only over HTTPS |

Also: the image is pinned (`n8nio/n8n:2.45.7`), Postgres is the backend, and on every start the entrypoint re-imports the shipped workflows and credentials, publishes them, and unpublishes any workflow that is no longer shipped, so a stale or hand-made workflow cannot stay active.

## Audit

`auditLog` rows record `actorId`, `actorType` (`user`, `admin`, `system`, `n8n`), `action` (for example `loan.approve`, `tool.moderate`, `user.trust`, `outboxEvent.replay`, `reminder.sent`), entity, status change and reason. They hold IDs, not personal data. There is no update or delete function for the table; the only code that deletes rows is the local-only `devtools` guarded by `ALLOW_DEV_TOOLS`. Admins read it in the console's Audit tab; parties see their loan's entries on the timeline.

## Known limitations

These are true of the code today. Fixes for the ones that matter in production are in [production.md](production.md).

1. **Clerk is a development instance** in the demo (dev keys, Clerk's development banner and limits). A production instance needs an owned app domain.
2. **CSP allows `'unsafe-inline'` scripts and styles.** A nonce-based policy needs dynamic rendering of every page.
3. **Inbound rate-limit buckets are global.** The HMAC is verified first, so unsigned floods get a 401 without touching the bucket (`convex/http.test.ts` proves 300 unsigned requests do not block a signed one), but there is no per-IP limit in front of Convex; edge rate limiting is a production item.
4. **The n8n editor is reachable on the same public domain as the webhook** in the demo. It is protected by the env-provisioned owner account with a generated password; MFA is not enforced.
5. **n8n's dedupe history is capped at 10,000 event IDs** (Remove Duplicates `historySize`, set explicitly). The design notes record that new notifications error once it is full. Ample for a demo; not for production.
6. **"Sent" means accepted by the SMTP server.** Bounces and complaints are not fed back.
7. **No sweeper for stuck events.** An event can stay `delivered` if n8n crashes after answering 202 and before the write-back, or `pending`/`retrying` if a delivery action dies without scheduling its retry. Counts show in the admin console, but nothing flags them.
8. **Alerts are pull-based.** Dead letters and a stale heartbeat show in the admin console and in structured logs; nobody is paged.
9. **The overdue query reads the first 200 overdue active loans before skipping those already reminded today**, so with more than 200 overdue loans some would never be reminded. Irrelevant at neighbourhood scale; pagination fixes it.
10. **Account deletion anonymizes rather than erases.** The `users` row keeps its Clerk ID; borrower messages on loans and the names and descriptions of removed listings stay. Deletion only propagates through the Clerk webhook, which needs a public URL (so not in local development). There is no self-service data export.
11. **No retention jobs.** Audit log, outbox, reminders and automation errors are kept indefinitely.
12. **n8n error executions keep their full input for 7 days**, including the recipient's email.
13. **Free-text fields are only as private as what people type.** Tool names appear on the public landing page; descriptions are visible to every signed-in neighbour.
14. **A bare "On loan" still hints at a late return.** Once an active loan passes its end date, `tools.browse` and `tools.get` stop returning the date to anyone but the owner, the borrower and admins (they get `{ state: "on_loan" }`), so the overdue fact itself is not exposed. A neighbour who saw "Back Nov 12" earlier and sees "On loan" later can still infer it; hiding due dates from everyone would remove that signal at a UX cost.
15. **Replaying a notification twice emails twice**, by design (each replay is a new event ID); the admin console asks for confirmation before a second replay.
16. **Browser E2E and the automation E2E run locally only.** CI runs everything that needs no Clerk instance or Docker stack.
17. **Single tenancy.** One neighbourhood; every signed-in user can browse every listing.
