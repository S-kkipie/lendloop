# ADR 0009: Users from token claims, Clerk webhooks for changes and deletion

- Status: accepted, 2026-10-31
- Covers: D11 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

Convex needs a `users` row (for display names, Trusted badges and email at send time). Relying only on Clerk webhooks breaks local development, where Clerk cannot reach `localhost`. Relying only on sign-in misses deletions and profile changes between sessions.

## Decision

- `users.syncMe` (the only `identityMutation`) upserts the row from the token's `name` and `email` claims once per session.
- A Svix-verified `POST /clerk/webhook` handles `user.updated` (refresh name and email) and `user.deleted` (anonymize).
- Deletion: remove the user's listings, cancel their pending and approved loans and notify the other party, keep active loans so they can be closed, set the name to "Former neighbour" and the email to `null`.
- Handlers are idempotent and order-tolerant: `user.updated` never resurrects a deleted account, and `syncMe` refuses a deleted one.

## Consequences

- Local development works with no webhook; production gets timely updates.
- Deletion anonymizes rather than erases (messages and the Clerk ID remain), documented in the [PII map](../pii-map.md#account-deletion).
- Two write paths for the same fields, both tested.
