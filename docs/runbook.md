# Runbook

Operational procedures for LendLoop. Commands assume the repository root. Add `--prod` to `pnpm exec convex …` commands to target the production deployment; locally they target the local deployment from `.env.local`.

Related: [integration contract](integration.md), [security](security.md), [production note](production.md).

## Contents

- [Where to look first](#where-to-look-first)
- [Rotate the HMAC secrets](#rotate-the-hmac-secrets)
- [Other secrets](#other-secrets)
- [Replay dead letters](#replay-dead-letters)
- [Stale reminder heartbeat](#stale-reminder-heartbeat)
- [n8n is down](#n8n-is-down)
- [Requests rejected with 401](#requests-rejected-with-401)
- [An email did not arrive, or bounced](#an-email-did-not-arrive-or-bounced)
- [Run the reminders now](#run-the-reminders-now)
- [Grant or revoke admin](#grant-or-revoke-admin)
- [Reset the local demo](#reset-the-local-demo)

## Where to look first

| Signal | Where |
|---|---|
| Outbox counts, dead and failed events, unresolved automation errors, reminder heartbeat, reminders in the last 24 h | Admin console → Automation tab (`/admin`) |
| What happened to one loan (transitions, notifications, reminders) | Loan timeline (`/loans/<id>`); admins see the sanitized delivery error |
| Who did what | Admin console → Audit tab |
| Convex events (`outbox.retry`, `outbox.dead`, `inbound.rejected` with its reason, `heartbeat.stale`, `automation.error`) | `pnpm exec convex logs`, or the Convex dashboard |
| Failed n8n executions (kept 7 days; successful ones are not stored) | n8n editor → Executions |
| Liveness | `GET <convex site URL>/health` → `{"ok":true}`; n8n `GET /healthz` |
| Emails | Mailpit at `http://localhost:8025` locally; Resend dashboard → Emails in production |

## Rotate the HMAC secrets

There are two secrets, one per direction. Signers use the current secret only; verifiers accept current and previous. **The verifier must learn the new secret before the signer starts using it**, otherwise requests signed in between are rejected (and a rejected Convex → n8n delivery goes `dead`, because a 401 is not retried).

| Direction | Signer | Verifier | Convex env | n8n env |
|---|---|---|---|---|
| Convex → n8n | Convex | n8n | `N8N_WEBHOOK_SECRET` | `LENDLOOP_N8N_WEBHOOK_SECRET`, `LENDLOOP_N8N_WEBHOOK_SECRET_PREVIOUS` |
| n8n → Convex | n8n | Convex | `CONVEX_INBOUND_SECRET`, `CONVEX_INBOUND_SECRET_PREVIOUS` | `LENDLOOP_CONVEX_INBOUND_SECRET` |

Generate each new value with `openssl rand -hex 32`. Pass values to the Convex CLI through stdin (as `scripts/setup.ts` does), never as arguments, so they stay out of shell history and process lists. With the value omitted, `convex env set` reads it from stdin:

```sh
umask 077; SECRET_FILE="$(mktemp)"
openssl rand -hex 32 | tr -d '\n' > "$SECRET_FILE"    # paste into Railway from this file too
pnpm exec convex env set N8N_WEBHOOK_SECRET --prod < "$SECRET_FILE"
rm -f "$SECRET_FILE"
```

### Production (zero downtime)

Convex → n8n:

1. Railway: set `LENDLOOP_N8N_WEBHOOK_SECRET_PREVIOUS` to the old value and `LENDLOOP_N8N_WEBHOOK_SECRET` to the new one. Railway redeploys; the entrypoint re-imports both credentials. n8n now accepts both.
2. Convex: set `N8N_WEBHOOK_SECRET` to the new value. Every delivery attempt signs afresh, so from now on everything is signed with the new secret.
3. After at least 5 minutes (the timestamp window), clear `LENDLOOP_N8N_WEBHOOK_SECRET_PREVIOUS` on Railway. When it is empty, the entrypoint feeds the previous credential with the current secret, so nothing else accepts the old one.

n8n → Convex:

1. Convex: set `CONVEX_INBOUND_SECRET_PREVIOUS` to the old value and `CONVEX_INBOUND_SECRET` to the new one. Convex accepts both at once.
2. Railway: set `LENDLOOP_CONVEX_INBOUND_SECRET` to the new value; wait for the redeploy. n8n signs with the new secret.
3. After at least 5 minutes, remove `CONVEX_INBOUND_SECRET_PREVIOUS`: `pnpm exec convex env remove CONVEX_INBOUND_SECRET_PREVIOUS --prod`.

During a Railway redeploy, deliveries to n8n fail with connection errors and are retried (30 s, then 2 min, …), so nothing is lost. Check the Automation tab afterwards: `retrying` should drain to `delivered`/`sent`, with no new `dead` events.

### Local

```sh
pnpm setup:local --rotate   # new values in n8n/.env, old ones kept as *_PREVIOUS, Convex updated
pnpm stack:up               # recreate n8n with the new credentials
```

`--rotate` orders the steps so there is no gap: it writes the new secrets to `n8n/.env` (old ones kept as `*_PREVIOUS`), gives Convex the new inbound secret plus both previous values, restarts n8n and waits until it is healthy and accepts both webhook secrets, and only then switches Convex to sign with the new Convex → n8n secret (`scripts/lib/rotation.ts`, tested). If the stack is not running it tells you to start n8n first and still updates Convex last. The n8n → Convex direction has no gap either, because Convex accepts the previous secret.

To finish a local rotation, delete the `*_PREVIOUS` lines from `n8n/.env`, run `pnpm exec convex env remove N8N_WEBHOOK_SECRET_PREVIOUS` and `pnpm exec convex env remove CONVEX_INBOUND_SECRET_PREVIOUS`, then `pnpm stack:up`.

## Other secrets

| Secret | How to rotate |
|---|---|
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk dashboard → Webhooks → endpoint → rotate the signing secret, then set the new `whsec_…` value in Convex. Svix keeps signing with the old secret for a while after rotation, so the switch can be made without dropped events; Clerk retries failed deliveries anyway. |
| `CLERK_SECRET_KEY` | Create a new secret key in Clerk (API keys), set it in Vercel and redeploy, then delete the old key. |
| `CONVEX_DEPLOY_KEY` | Generate a new production deploy key in the Convex dashboard, set it in Vercel, revoke the old one. |
| SMTP password (Resend API key) | Create a new sending-only key for `lendloop.aido.lat`, set `SMTP_PASS` on Railway (redeploy re-imports the SMTP credential), then delete the old key in Resend. |
| `N8N_ENCRYPTION_KEY` | Do not rotate casually: n8n has no re-encryption command, and losing the key makes stored credentials unreadable. The entrypoint re-imports all three LendLoop credentials from env on every start, but test any change against a copy of the database first. |
| n8n owner password | Locally: delete `N8N_OWNER_PASSWORD` and `N8N_INSTANCE_OWNER_PASSWORD_HASH` from `n8n/.env`, run `pnpm setup:local` and `pnpm stack:up`. In production: set a new bcrypt hash in `N8N_INSTANCE_OWNER_PASSWORD_HASH` on Railway. |

## Replay dead letters

`dead` means Convex gave up on delivering to n8n; `failed` means n8n accepted the event but could not send the email.

1. Admin console → Automation tab. Read `lastError` on each problem row:
   - `n8n responded 401`: signature or secret mismatch. Fix the configuration first ([Requests rejected with 401](#requests-rejected-with-401)), or every replay will die the same way.
   - `n8n responded 5xx`, a timeout or a network error: n8n was down or overloaded. Confirm it is healthy.
   - `N8N_WEBHOOK_URL is not set` or `… shorter than 32 characters`: Convex configuration.
   - For `failed` events, the matching automation error shows the SMTP message (emails removed).
2. Open the loan's timeline and check that the notification still makes sense. The replay is rebuilt from current data but uses the original event type's wording.
3. Press **Replay**. The replay is a new event and appears in the outbox as `pending`, then `delivered`, then `sent`. The original row is marked "Replayed … ago".
4. Do not replay the same event twice unless you know the first replay did not get through: each replay is a new event ID, so a second replay sends a second email. The console asks for confirmation for exactly this reason.
5. Resolve the related automation error (Resolve button) once handled. Resolving only hides it; it changes nothing else.

## Stale reminder heartbeat

The heartbeat tile turns stale when `GET /n8n/overdue-loans` has not been called successfully for 26 hours. Convex also logs `heartbeat.stale` every hour while it lasts.

1. Is n8n up? `GET https://<n8n host>/healthz`, or `docker compose --env-file n8n/.env ps` locally. If not, see [n8n is down](#n8n-is-down).
2. Is `overdue-reminders` active? n8n editor → Workflows. The entrypoint publishes it on every start; if it is inactive, restart the service rather than activating it by hand.
3. Did it run and fail? n8n → Executions (errors are kept 7 days), and the Automation tab's errors list (the error workflow reports there). An email to `OPS_EMAIL` with workflow `overdue-reminders` means n8n could not reach Convex at all.
4. Can n8n authenticate to Convex? `pnpm exec convex logs` shows `inbound.rejected` with `reason: mismatch` (wrong secret) or `stale` (clock skew over 300 s). Fix `LENDLOOP_CONVEX_INBOUND_SECRET` / `CONVEX_INBOUND_SECRET`, or the host clock.
5. Is the time zone right? The schedule runs daily at 09:00 in `GENERIC_TIMEZONE`; `APP_TIMEZONE` in Convex should match.
6. [Run the reminders now](#run-the-reminders-now) and confirm the tile shows a fresh check-in.

## n8n is down

Symptoms: `retrying` rises in the Automation tab, `outbox.retry` lines in the Convex logs, then `dead` after about 73 minutes per event.

1. Locally: `docker compose --env-file n8n/.env ps` and `docker compose --env-file n8n/.env logs n8n --tail 100`. In production: Railway → the n8n service → Deployments and logs.
2. Common causes: Postgres not ready or out of space, a missing required variable (the entrypoint exits with `lendloop-entrypoint: <NAME> is required`), a broken workflow render (the entrypoint fails fast on invalid JSON), or the Railway service sleeping.
3. Restart: `pnpm stack:up` locally, or redeploy on Railway. The entrypoint re-imports credentials and workflows, publishes them and unpublishes anything not shipped in the image.
4. Events still `retrying` deliver on their next attempt by themselves. Replay any that went `dead` while n8n was down.
5. If the outage spanned 09:00 in `GENERIC_TIMEZONE`, [run the reminders now](#run-the-reminders-now).

## Requests rejected with 401

| Seen as | Meaning | Fix |
|---|---|---|
| Events `dead` with `n8n responded 401` | n8n rejected Convex's signature | `N8N_WEBHOOK_SECRET` in Convex must equal `LENDLOOP_N8N_WEBHOOK_SECRET` (or `_PREVIOUS`) in n8n; check the path in `N8N_WEBHOOK_URL` is `/webhook/lendloop-loan-events` (it is signed) |
| `inbound.rejected` in Convex logs, n8n HTTP nodes failing with 401 | Convex rejected n8n | `LENDLOOP_CONVEX_INBOUND_SECRET` in n8n must equal `CONVEX_INBOUND_SECRET` (or `_PREVIOUS`) in Convex |
| `reason: stale` | clock difference over 300 s | fix the host clock (NTP) |
| `503 not_configured` | the Convex secret is missing or shorter than 32 characters | set it |
| `clerk_webhook.rejected` | Svix signature failed | `CLERK_WEBHOOK_SIGNING_SECRET` must be the endpoint's current `whsec_…` value |

After fixing, replay the dead events.

## An email did not arrive, or bounced

1. Find the loan's timeline. "Queued" means the event is not `sent` yet; check its status in the Automation tab. `skipped` means the recipient's account was deleted or has no email.
2. `sent` means the SMTP server accepted the message. Check the provider: Mailpit locally; in production the Resend dashboard → Emails, filtered by time (the app never shows full addresses, so search by timestamp and subject).
3. Resend shows **Bounced**: the address is wrong or the mailbox is gone, and Resend adds hard bounces to its suppression list. The user fixes their email in Clerk (the `user.updated` webhook and the next sign-in update Convex). A `sent` event cannot be replayed; the next notification goes to the new address.
4. Resend shows **Delivered** but the user sees nothing: spam folder. Check SPF, DKIM and DMARC for `lendloop.aido.lat` in Resend's domain page.
5. Resend rejects at SMTP time (unverified domain, invalid key, sending limits): n8n's `Send email` fails after 5 tries, the event becomes `failed` and an automation error appears. Fix the cause, then replay.

## Run the reminders now

- n8n editor → `overdue-reminders` → the "Run now" manual trigger → Execute workflow.
- Locally from the CLI (the running n8n's task broker owns port 5679, so the CLI needs its own):

  ```sh
  docker compose --env-file n8n/.env exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n \
    n8n execute --id=llOverdueRemind01
  ```

Running it twice on the same day is safe: loans with a `sent` reminder today are skipped, and `failed` ones are retried.

## Grant or revoke admin

Clerk dashboard → Users → the user → Metadata → **Public** metadata: `{"role": "admin"}` to grant, remove the key to revoke. Never use unsafe metadata (user-writable). The change reaches Convex when the session token refreshes (within 60 seconds) or on the next sign-in. Every admin action is audited with the admin's ID.

## Reset the local demo

```sh
pnpm exec convex env set ALLOW_DEV_TOOLS true   # once, local deployment only
pnpm db:reset-demo                              # empty every app table, then re-seed
```

`devtools:resetDemo` deletes all rows from the app's tables (users, tools, loans, outbox, reminders, automation errors, heartbeats, audit log) and runs the same seed as `pnpm seed`. Real accounts are recreated on their next page load (`users.syncMe` runs again). It refuses to run unless `ALLOW_DEV_TOOLS=true`; never set that on production. To also clear the automation side, clear Mailpit's inbox in its UI; n8n keeps its dedupe history, which is harmless because new events have new IDs.
