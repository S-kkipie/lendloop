# ADR 0007: IDs-only outbox, payloads built at send time

- Status: accepted, 2026-10-31
- Covers: D9 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

An outbox that stores rendered payloads accumulates copies of emails and names, keeps them after an account is deleted, and can send stale data on retry.

## Decision

`outboxEvents`, `reminders`, `automationErrors`, `auditLog` and logs hold IDs, statuses and sanitized messages only. `buildNotificationPayload` assembles the payload at each delivery attempt from current data, limited to an allowlist (`PAYLOAD_KEYS`): the recipient's own email and first name, the counterpart's first name, the tool name, loan dates and status, and a link. A test fails on any extra key. If the recipient was deleted, the event becomes `skipped` and nothing leaves Convex.

## Consequences

- Deleting an account stops pending emails to it, with no data to scrub from the outbox.
- n8n never sees last names, the other party's email, the borrower's message or tool descriptions.
- A replay or retry sends current data, which can differ from the moment of the event (the copy still follows the original event type).
- Each attempt costs a few reads; negligible at this scale.
