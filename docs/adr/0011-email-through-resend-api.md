# ADR 0011: Email through Resend's HTTPS API

- Status: accepted, 2026-11-01
- Covers: the transport part of [ADR 0004](0004-email-only-notifications.md); the credential in [ADR 0008](0008-n8n-secrets-in-credentials.md)

## Context

n8n first sent email over SMTP. Production n8n runs on Railway's Hobby plan, and Railway blocks outbound SMTP (ports 25, 465, 587, 2525) on Free, Trial and Hobby plans. Its docs point to transactional email HTTPS APIs instead. The production smoke test hung on the SMTP send.

SMTP also has no idempotency. n8n retries a failed send up to 5 times, 5 s apart. If an attempt went through but its response was lost, the retry could send the email twice.

## Decision

The three email nodes (`Send email`, `Send reminder`, `Email ops`) are HTTP Request nodes that `POST {MAIL_API_URL}/emails` in Resend's request format (`from`, `to`, `subject`, `text`). They authenticate with the Header Auth credential "LendLoop Mail API" (`Authorization: Bearer <MAIL_API_KEY>`) and send an `Idempotency-Key` header:

- notifications: `lendloop-<eventId>`
- reminders: `lendloop-reminder-<loanId>:<YYYY-MM-DD>`
- ops alert: `lendloop-ops-<failed executionId>`

Resend treats the same key with the same payload as one email for 24 hours. A repeat gets the original response; the same key with a different payload is a 409.

Locally, the compose service `mail-api` (`node:24.15.0-alpine`, runs `n8n/local-mail-api.ts`, no dependencies, not exposed on the host) implements the same subset: bearer key check, validation, and the same idempotency rules. It relays each message to Mailpit over SMTP, so Mailpit's chaos mode still makes sends fail in the automation E2E. An SMTP rejection becomes a 502 with the SMTP reply in the message.

`MAIL_API_URL` (`http://mail-api:8080` locally, `https://api.resend.com` in production) is a fourth workflow placeholder. `MAIL_API_KEY` is a secret: random hex from `pnpm setup:local` locally, a sending-only Resend key restricted to `lendloop.aido.lat` in production. The `SMTP_*` variables are gone.

Considered and rejected:

- Upgrading Railway to Pro just for SMTP: extra cost, and SMTP would still lack idempotency.
- An SMTP-to-HTTPS relay service in the Railway project: an extra production-only moving part that local tests would not cover.

## Consequences

- n8n's retries can no longer send an email twice when an attempt succeeded but its response was lost.
- Local and production use the same workflow JSON and the same request shape. Only `MAIL_API_URL` and the key differ.
- "Sent" means accepted by Resend's API in production (accepted by Mailpit through the local mail API locally). Bounces and complaints are still not fed back ([production.md](../production.md#email)).
- A non-2xx answer makes the node retry, then feeds the failure report or `Mark failed`. Those messages include the mail API's response body with email addresses replaced by `[email]`.
- The local mail API is a test double. It covers only the Resend subset the workflows use, and its tests are in `tests/n8n/local-mail-api.test.ts`.
