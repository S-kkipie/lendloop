# ADR 0002: Admin role from a signed Clerk claim

- Status: accepted, 2026-10-31
- Covers: D3 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

The app has two roles, neighbour and admin. A role stored in an app table is one more mutable thing an attacker could target, and a role sent by the client is worthless. Convex already verifies a Clerk JWT on every call.

## Decision

The role lives in Clerk `publicMetadata.role`, which only the backend (dashboard or Backend API) can write; `unsafeMetadata` is never used. A session-token claim `"role": "{{user.public_metadata.role}}"` carries it to Convex, where `parseRole` maps exactly `"admin"` to admin and anything else, including a missing claim, to user. The role is read from the token on every call and never stored in Convex.

## Consequences

- No code path in LendLoop can grant admin; it takes a Clerk dashboard change.
- Revocation reaches Convex when the session token refreshes (60 seconds) or on the next sign-in, not instantly.
- Admins are still least-privilege: they moderate and observe, but cannot act on other people's loans (see the [authorization matrix](../authz-matrix.md)).
- Tests can simulate any role with `convex-test` identities, which is how the matrix is asserted.
