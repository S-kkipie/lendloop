# ADR 0001: Public demo and full local stack, one n8n image

- Status: accepted, 2026-10-31
- Covers: D1, D2 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

Reviewers should be able to click a URL, and also run everything offline to inspect it. Convex cloud cannot call `localhost`, so a cloud deployment cannot reach a local n8n. There is no official n8n template for Railway, and hand-configured n8n instances drift from what is in git.

## Decision

- Demo: Vercel (Next.js), a Convex production deployment, n8n plus Postgres on Railway, Resend for email.
- Local: Next.js and a **Convex local deployment** on the host, and n8n, Postgres and Mailpit in Docker Compose. Convex reaches n8n at `localhost:5678`; n8n reaches Convex at `host.docker.internal:3211`.
- n8n runs from our own image (`n8n/Dockerfile`, pinned `n8nio/n8n:2.45.7`) in both places. Its entrypoint renders three placeholders, imports credentials from env, imports and publishes the shipped workflows, and unpublishes any workflow not shipped.

## Consequences

- Local equals production for n8n: workflows live only in git, and every start converges the instance to them.
- `pnpm setup:local` and `pnpm stack:up` give a working stack with no clicks in n8n.
- Two environments to keep in sync by hand (env vars per platform); a secret manager is the production fix ([production.md](../production.md#secrets-manager-and-rotation)).
- The hardening variables live in `docker-compose.yml`, not the image, so Railway must set them explicitly.
