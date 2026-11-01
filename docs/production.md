# Production note

The take-home asked what I would change before real users rely on this. The demo is deployed the way a small production system would be (separate deployments, real email, signed integration, no dev tools), but several things are deliberately left at demo level. This note lists them in priority order with the concrete fix.

Related: [security known limitations](security.md#known-limitations), [runbook](runbook.md), [integration](integration.md).

## Live demo

| | |
|---|---|
| App | <!-- TODO(live): Vercel production URL --> |
| Convex health | <!-- TODO(live): https://<deployment>.convex.site/health --> |
| n8n | <!-- TODO(live): Railway n8n public URL (webhook only; the editor login is private) --> |
| Email | Resend email API (HTTPS), sending domain `lendloop.aido.lat`, from `LendLoop <no-reply@lendloop.aido.lat>` |
| Identity | Clerk development instance |
| Test accounts | An admin and a regular neighbour; credentials are in the submission email, never in the repo |

<!-- TODO(live): date the demo was last verified (sign-in, request → email, reminders run, admin automation tab healthy) -->

### How the demo is deployed

| Piece | Where | Notes |
|---|---|---|
| Next.js | Vercel, from the GitHub repo | Build command `npx convex deploy --cmd 'pnpm build'` with `CONVEX_DEPLOY_KEY`, so Convex functions and the frontend ship together |
| Convex | production deployment | Env: `CLERK_JWT_ISSUER_DOMAIN`, `APP_URL` (the Vercel URL), `APP_TIMEZONE`, `N8N_WEBHOOK_URL` (Railway URL + `/webhook/lendloop-loan-events`), `N8N_WEBHOOK_SECRET`, `CONVEX_INBOUND_SECRET`, `CLERK_WEBHOOK_SIGNING_SECRET`. Never `ALLOW_DEV_TOOLS`. |
| n8n | Railway service built from `n8n/Dockerfile`, Railway Postgres | Same image as local. Variables from `n8n/.env.example` with fresh production secrets, `CONVEX_SITE_URL` = the Convex `.convex.site` URL, `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM`, `OPS_EMAIL`, `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `N8N_HOST` and `N8N_PROTOCOL` for the public Railway domain, `N8N_PROXY_HOPS=1` (Railway's edge proxy), `N8N_PORT=5678`, and `DB_POSTGRESDB_*` as references to the Postgres service. The hardening settings from [security.md](security.md#n8n-hardening), `DB_TYPE` and `N8N_SECURE_COOKIE=true` come from the image |
| Email | Resend | `MAIL_API_URL=https://api.resend.com`, `MAIL_API_KEY` = a sending-only API key restricted to `lendloop.aido.lat`; SPF and DKIM records in Cloudflare DNS. Railway blocks outbound SMTP on the Hobby plan, which is why n8n uses the HTTPS API ([ADR 0011](adr/0011-email-through-resend-api.md)) |
| Clerk | development instance | Webhook endpoint `<convex site URL>/clerk/webhook` for `user.updated` and `user.deleted` |
| Demo data | `npx convex run seed:demo --prod` | Fictional neighbours who cannot sign in |

Production secrets are generated for production only (none are shared with the local stack) and move between tools through stdin or 0600 files that are deleted afterwards.

## Summary

| # | Change | Why | Effort |
|---|---|---|---|
| 1 | [Clerk production instance](#clerk-production-instance) on an owned domain | dev instances are not for real users | small |
| 2 | [Secret manager and scheduled rotation](#secrets-manager-and-rotation) | secrets are set by hand per platform today | medium |
| 3 | [Move n8n dedupe into Convex](#move-dedupe-into-convex) | the n8n history cap is 10,000 event IDs | small |
| 4 | [Alerting](#observability): log drain, Sentry, uptime and heartbeat monitors, stuck-event sweeper | failures are visible but nobody is paged | medium |
| 5 | [n8n queue mode, workers, backups, private editor](#n8n-operations) | one n8n process, public editor | medium |
| 6 | [Nonce-based CSP](#nonce-based-csp) | `'unsafe-inline'` scripts today | medium |
| 7 | [Retention and purge jobs](#retention-and-purge) | everything in Convex is kept forever | small |
| 8 | [Data export and erasure](#data-subject-rights) | deletion anonymizes; no export | medium |
| 9 | [Rate-limit tuning and edge protection](#rate-limits-and-edge-protection) | global inbound buckets (signature is checked first); no per-IP edge limit | small |
| 10 | [Bounce and complaint handling](#email) | "sent" means accepted by Resend's API | small |
| 11 | [Assurance](#assurance): pentest, E2E in CI, staging | E2E is local only | medium |
| 12 | [Tenancy](#tenancy) | one neighbourhood | large |

## Clerk production instance

- Create a production instance on an owned app domain (Clerk requires DNS records for its Frontend API, account portal and email sending under that domain). The demo stays on a development instance because it has no owned app domain; the Vercel URL is not enough.
- Recreate the setup there: the Convex integration, the session-token claims (`aud`, `role`, `email`, `name`), the webhook endpoint for `user.updated` and `user.deleted`. Update `CLERK_JWT_ISSUER_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_…`), `CLERK_SECRET_KEY` (`sk_live_…`) and `CLERK_WEBHOOK_SIGNING_SECRET`.
- Turn on what a clinician-facing product would expect: MFA (required for admins), bot protection on sign-up, session lifetime suited to shared devices.
- Admin grants stay in `publicMetadata`, but go through a small audited admin flow instead of the Clerk dashboard.

## Secrets: manager and rotation

- One source of truth (for example Doppler, Infisical, 1Password Secrets Automation or a cloud secret manager) syncing into Vercel, Convex and Railway. Nobody copies secrets between dashboards by hand.
- Rotation cadence: HMAC secrets every 90 days and immediately on suspected exposure; Resend API key every 90 days; Clerk secret key and webhook secret yearly or on staff change; Convex deploy key on staff change. `N8N_ENCRYPTION_KEY` only with a tested re-encryption plan.
- Automate the two-phase rotation from the [runbook](runbook.md#rotate-the-hmac-secrets): verifier first (n8n gets new + previous), then signer, then drop the previous secret after the 5-minute window. Locally, `pnpm setup:local --rotate` should restart n8n before pushing the new Convex → n8n secret to close its short gap.
- Keep gitleaks in CI and add push protection on the repository.

## Move dedupe into Convex

Today n8n's Remove Duplicates node remembers event IDs in its own Postgres table with `historySize` set explicitly to 10,000. The design notes record that new notifications error once that history is full, and the history is lost if n8n's database is.

Fix: make Convex the dedupe authority, since it already owns the outbox.

1. Add a signed `POST /n8n/notifications/claim {eventId}` endpoint. It atomically moves the outbox event from `pending`/`retrying`/`delivered` to a new `accepted` status and returns `200 {"claimed":true}` the first time, `200 {"claimed":false}` afterwards.
2. In `loan-notifications`, replace Remove Duplicates with this call (Retry On Fail, 3 tries). Only a claimed event is sent.
3. No cap, survives n8n data loss, visible in the admin console, and covered by `convex-test` like every other endpoint.

The cheaper alternative, a periodic `clearDeduplicationHistory` with a larger window, reopens duplicates for recent IDs whenever it runs, so it is only acceptable if clearing waits longer than the whole retry window (about 73 minutes).

## Observability

- **Logs:** stream Convex logs (already structured and redacted JSON) to a log drain (Axiom, Datadog or similar) and alert on `outbox.dead`, `heartbeat.stale`, `automation.error` and bursts of `inbound.rejected`.
- **Errors:** Sentry for Next.js (client and server) and Convex function exceptions, with PII scrubbing on.
- **Uptime:** external monitors on the app URL, `GET <convex site>/health` and n8n `/healthz`.
- **Heartbeat:** keep the in-app check, and also have the Convex `check reminder heartbeat` cron (or n8n after each run) ping an external dead-man's-switch (Healthchecks.io, Better Stack), so a stopped schedule pages someone instead of waiting for an admin to open the console.
- **Stuck events:** a Convex cron that flags events in `delivered` for over an hour without a write-back (n8n crashed between 202 and sending) and events in `pending`/`retrying` whose `nextAttemptAt` is long past (a delivery action died), and reschedules or alerts.

## n8n operations

- **Queue mode:** `EXECUTIONS_MODE=queue` with Redis, one main instance (editor, schedules) and separate worker processes, plus webhook processors if traffic grows. Concurrency limits per worker so a slow email API does not pile up executions.
- **Backups:** managed Postgres with point-in-time recovery. n8n's state is small (credentials are re-imported from env, workflows come from git), but error executions and the dedupe table live there until item 3 lands.
- **Editor access:** expose only `/webhook/lendloop-loan-events` publicly (Railway private networking plus a proxy, or Cloudflare Access in front of the editor), and enforce MFA for the n8n owner.
- **Image:** keep the pinned version, rebuild on n8n security releases, scan the image in CI.

## Nonce-based CSP

The current CSP allows `'unsafe-inline'` scripts because the pages are statically prerendered and Next.js injects inline bootstrap scripts. A per-request nonce (`script-src 'nonce-…' 'strict-dynamic'`) generated in `proxy.ts` removes that, at the cost of rendering every page dynamically. Clerk's CSP guide covers the nonce setup for its scripts. Add `report-to` with a CSP reporting endpoint first, run report-only for a week, then enforce.

## Retention and purge

Convex keeps every row today. Proposed policy, each implemented as a Convex cron with an audit entry per run:

| Data | Keep | Then |
|---|---|---|
| Outbox events `sent`, `skipped` | 90 days | delete |
| Outbox events `dead`, `failed` | until replayed or resolved, max 1 year | delete |
| Reminders | 1 year | delete |
| Resolved automation errors | 90 days | delete |
| Closed loans' `message` | 90 days after the loan closes | clear the field |
| Audit log | per the organization's policy (for example 2 years) | archive to cold storage, then delete |
| n8n error executions | 7 days (already) | pruned by n8n |

## Data subject rights

- **Export:** a "Download my data" action that assembles the user's row, their tools, their loans (with their own messages), and audit entries where they are the actor or the entity, as JSON. Rate-limited and audited.
- **Erasure:** today a Clerk `user.deleted` anonymizes the row and closes open loans. For erasure: clear borrower messages and removed listings' text, drop the Clerk ID once late webhooks are no longer possible (after Clerk's retry window), and offer deletion from inside the app (calling Clerk's API, which then fires the webhook).
- **Processors:** data processing agreements with Clerk, Convex, Vercel, Railway and Resend; pick regions deliberately (Convex deployment region, Railway region) and record them.

## Rate limits and edge protection

- The HMAC is already checked before the shared `inboundHttp` bucket is consumed; add per-caller keys if more than one automation client appears.
- Put the app behind Vercel's firewall (or Cloudflare) with per-IP limits; keep Clerk's bot protection on sign-up.
- Tune `loanRequest` (10 per hour) and `toolCreate` (20 per day) from real usage; add a per-owner limit on incoming requests to stop harassment through repeated requests.

## Email

- DMARC (start with `p=none` and reports, move to `quarantine`), alongside the SPF and DKIM records Resend already needs.
- Resend webhooks for `email.bounced` and `email.complained` into a signed Convex endpoint, so a bounce marks the event and flags the user's address instead of staying `sent`.
- HTML templates with a plain-text part, a footer explaining why the email was sent, and a link to notification settings once those exist.

## Assurance

- External penetration test before real users, scoped to the authorization matrix, the HTTP endpoints, the n8n exposure and the CSP.
- Run the Playwright suite and `pnpm e2e:automation` in CI against a staging Clerk instance and the compose stack (both are local only today).
- A staging environment (Convex preview or a second deployment, a second Railway service) that every change passes through before production.
- CodeQL or similar SAST next to Dependabot.

## Tenancy

The app is one neighbourhood. Multi-neighbourhood support means a `neighbourhoods` table, memberships with roles per neighbourhood (an admin of one is not an admin of another), invites, and a `neighbourhoodId` on tools and loans that the auth wrappers inject and every index starts with. The authorization matrix grows a "member of another neighbourhood" actor, which should always see `NOT_FOUND`.

## Scale notes

Fine for a neighbourhood, wrong for a city:

- Admin lists read at most 500 rows and the overdue query at most 200 loans (some could be skipped beyond that; see [known limitations](security.md#known-limitations)). Paginate.
- `tools.listPublic` and `tools.browse` scan up to 200 and 300 listed tools and check each for an active loan. Denormalize availability onto the tool, or add search indexes.
- One outbox event per recipient is right; batching would only matter at much higher volume.

## Cost

All of it fits in free tiers or a few dollars a month at demo scale. What grows with real use:

- **Railway:** usage-billed. Queue mode adds Redis and worker containers; Postgres with backups is the largest fixed cost.
- **Convex:** function calls, database bandwidth and storage. Realtime queries re-run on every change they depend on, so denormalizing availability (scale notes) also cuts cost.
- **Resend:** per email beyond the free allowance; one reminder per overdue loan per day is the main driver.
- **Clerk:** per monthly active user above the free tier; MFA and some security features are on paid plans.
- **Sentry, log drain, uptime monitors:** usually the first paid line items. Keep log retention short since logs carry no personal data anyway.

Check each provider's current pricing before committing.
