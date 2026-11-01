# ADR 0005: Transactional outbox with retries and dead letters

- Status: accepted, 2026-10-31
- Covers: D7 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

Calling n8n directly from a mutation is impossible (mutations cannot do network I/O), and calling it from an action after the mutation risks losing the event if the action fails, or sending an email for a change that rolled back. Admins also need to see what was sent and what failed.

## Decision

- Each loan change inserts an `outboxEvents` row (IDs only) and schedules `deliver` in the **same** mutation. Scheduling is atomic with the commit.
- `deliver` claims the event with a 60-second lease, builds the payload, signs and POSTs it with a 10-second timeout.
- 2xx → `delivered`; 408, 429, 5xx, network errors and timeouts → `retrying` (30 s, 2 min, 10 min, 1 h; at most 5 attempts) → `dead`; any other 4xx → `dead` at once.
- n8n writes back `sent`, or reports `failed` with the event ID.
- Admins replay `dead` and `failed` events as new events (`replayOf`).

## Consequences

- No lost events and no phantom emails for rolled-back changes.
- Delivery state feeds the admin health panel and each loan's timeline ("Queued" versus "Email sent").
- More code than a fire-and-forget call, and stuck `delivered` events need a sweeper in production ([production.md](../production.md#observability)).
