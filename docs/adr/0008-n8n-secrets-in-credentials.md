# ADR 0008: n8n secrets in credentials, environment blocked in nodes

- Status: accepted, 2026-10-31
- Covers: D10 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

The quick way to give a workflow a secret is `$env.SECRET`. But the n8n process environment also holds `N8N_ENCRYPTION_KEY` and the database password, and any Code node could read and exfiltrate them. Exported workflow JSON with inline secrets ends up in git.

## Decision

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`: `$env` throws inside workflows.
- Secrets live in n8n credentials with fixed IDs: two Crypto credentials for the Convex → n8n secret (current and previous), one for n8n → Convex, one SMTP credential. `entrypoint.sh` creates them from env on every start through a temporary 0600 file that it deletes, and n8n encrypts them at rest.
- HMACs are computed by Crypto nodes; Code nodes only build canonical strings and compare, with no `crypto` builtin.
- Non-secret config is rendered into the workflow JSON at start from three allowlisted placeholders: `{{CONVEX_SITE_URL}}`, `{{MAIL_FROM}}`, `{{OPS_EMAIL}}`.

## Consequences

- Exported workflows contain credential references only; a lint test fails on anything secret-like.
- Workflows cannot read infrastructure secrets even if a node is compromised.
- Changing a secret means restarting n8n, which the entrypoint makes idempotent.
