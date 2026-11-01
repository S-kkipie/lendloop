# ADR 0004: Notifications by email only

- Status: accepted, 2026-10-31
- Covers: D6 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

n8n can post to Slack, Discord, SMS gateways and more. Every notification here is about one person's loan: who wants to borrow what, when it is due, that it is late.

## Decision

Email only, one recipient per message. Mailpit (pinned `axllent/mailpit:v1.33.0`) catches mail locally and doubles as a chaos tool for the automation E2E; the Resend email API on the sending domain `lendloop.aido.lat` delivers in production. The transport changed from SMTP to Resend's HTTPS API in [ADR 0011](0011-email-through-resend-api.md). Emails are plain text and use first names only.

## Consequences

- A team channel webhook would have broadcast neighbours' loan details to everyone in it; email keeps each message 1:1.
- Plain text means no tracking pixels and nothing to render unsafely.
- Delivery is "accepted by the mail API": bounces are not fed back yet ([production.md](../production.md#email)).
- No notification preferences or other channels (a stated non-goal).
