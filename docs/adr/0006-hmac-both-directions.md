# ADR 0006: HMAC signing in both directions with separate secrets

- Status: accepted, 2026-10-31
- Covers: D8 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

The n8n webhook and the Convex HTTP actions are public URLs. Without authentication, anyone could make LendLoop send emails, or write reminders and errors into Convex. Static bearer tokens can be replayed and say nothing about the request they travel with.

## Decision

- HMAC-SHA256 over `timestamp.METHOD.path.rawBody`, sent as `X-LendLoop-Signature: v1=<hex>` with `X-LendLoop-Timestamp`.
- 300-second window; constant-time comparison on both sides (`crypto.subtle.verify` in Convex, a hand-written loop in an n8n Code node, with the HMAC itself computed by n8n's Crypto node from a credential).
- One secret per direction: `N8N_WEBHOOK_SECRET` (Convex → n8n) and `CONVEX_INBOUND_SECRET` (n8n → Convex), at least 32 random bytes.
- Verifiers accept the current and the previous secret, so rotation needs no downtime.
- Shared vectors (`contracts/hmac-vectors.json`) test both implementations.

## Consequences

- A captured request cannot be replayed later, against another endpoint, or with a modified body.
- A leaked secret forges one direction only.
- Rotation is a two-step procedure whose order matters ([runbook](../runbook.md#rotate-the-hmac-secrets)).
- Two implementations of the same scheme, kept honest by the contract tests.
