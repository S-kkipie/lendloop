# LendLoop Plan 2b: n8n Workflows, Image and Local Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible n8n side for LendLoop: our own n8n image (owner, credentials and workflows provisioned from environment at start), a docker-compose stack (n8n + Postgres + Mailpit), the three workflows (`loan-notifications`, `overdue-reminders`, `error-handler`), a one-command secret setup, static/contract tests over the exported workflow JSON, and a verified end-to-end run against the local Convex deployment.

**Architecture:** Convex (local deployment on the host) signs and POSTs events to `http://localhost:5678/webhook/lendloop-loan-events`; n8n (in Docker) verifies, deduplicates, emails through Mailpit, and calls back `http://host.docker.internal:3211/n8n/*` with signed requests. Secrets live in env files that are gitignored and are turned into encrypted n8n credentials at container start; workflow JSON in git contains only credential references and `{{PLACEHOLDER}}` tokens for non-secret config.

**Tech Stack:** n8n 2.45.7 (`n8nio/n8n:2.45.7`), Postgres 17, Mailpit (`axllent/mailpit`), Docker Compose v5, Node 24 + tsx for scripts, Vitest (`node` project) for workflow tests.

**Spec:** `docs/superpowers/specs/2026-10-31-lendloop-design.md` §7.2–§7.6, §8 (secrets, n8n hardening), §12 (local setup), §15 (n8n spikes).

**Depends on:** Plans 1 and 2a (on `main`). Contract: `convex/automation/contract.ts`, vectors: `contracts/hmac-vectors.json`.

## Verified facts (spike, 2026-10-31, n8n 2.45.7)

- Node versions available: webhook 2.1, respondToWebhook 1.4, code 2, crypto 2, if 2.2, removeDuplicates 2, switch 3.2, emailSend 2.1, httpRequest 4.2, scheduleTrigger 1.2, splitOut 1, errorTrigger 1.
- Crypto v2 HMAC: `action: "hmac"`, `type: "SHA256"`, `value`, `dataPropertyName`, `encoding: "hex"`, `binaryData: false`; secret from credential type `crypto`, field `hmacSecret`.
- Webhook 2.1 options include `rawBody` (raw body as binary property, default `data`) and `ipWhitelist`; `responseMode: "responseNode"`.
- Remove Duplicates v2: `operation: "removeItemsSeenInPreviousExecutions"`, `logic: "removeItemsWithAlreadySeenKeyValues"`, `dedupeValue`, `options.scope: "workflow"`.
- emailSend 2.1: `fromEmail`, `toEmail`, `subject`, `emailFormat` (`text|html|both`), `text`, `html`; credential type `smtp`.
- CLI: `n8n import:credentials --input=file.json`, `n8n import:workflow --separate --input=dir`, `n8n publish:workflow --id=<id>` (activation; `update:workflow` is deprecated). Workflow JSON must carry a fixed `id` so it can be published.
- Owner provisioned from env: `N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true`, `N8N_INSTANCE_OWNER_EMAIL`, `N8N_INSTANCE_OWNER_FIRST_NAME`, `N8N_INSTANCE_OWNER_LAST_NAME`, `N8N_INSTANCE_OWNER_PASSWORD_HASH` (bcrypt). A public instance is therefore never claimable.
- Still to verify in Task 2: whether `import:credentials` accepts plaintext `data` objects (and encrypts them), how a Code node reads the raw-body binary (`this.helpers.getBinaryDataBuffer(i, 'data')` vs inline base64) under task runners, and that `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` does not break the workflows.

## Global Constraints

- Pin `n8nio/n8n:2.45.7`, `postgres:17-alpine`, `axllent/mailpit:v1` (or the current v1.x tag; record it).
- n8n env: `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_SAVE_ON_ERROR=all`, `EXECUTIONS_DATA_MAX_AGE=168`, `EXECUTIONS_DATA_PRUNE=true`, `N8N_DIAGNOSTICS_ENABLED=false`, `N8N_PERSONALIZATION_ENABLED=false`, `N8N_VERSION_NOTIFICATIONS_ENABLED=false`, `N8N_TEMPLATES_ENABLED=false`, `N8N_PUBLIC_API_DISABLED=true`, `DB_TYPE=postgresdb`, `GENERIC_TIMEZONE` = `APP_TIMEZONE`.
- Workflow IDs (fixed): `llLoanNotify0001`, `llOverdueRemind01`, `llErrorHandler001`. Credential IDs/names (fixed): `llCryptoInbound01` "LendLoop: Convex→n8n HMAC" (verifies Convex), `llCryptoOutbound1` "LendLoop: n8n→Convex HMAC" (signs to Convex), `llSmtp0000000001` "LendLoop SMTP".
- Placeholders allowed in workflow JSON: `{{CONVEX_SITE_URL}}`, `{{MAIL_FROM}}`, `{{OPS_EMAIL}}`. Nothing else is substituted.
- Webhook path: `lendloop-loan-events` (Convex `N8N_WEBHOOK_URL` = `http://localhost:5678/webhook/lendloop-loan-events` locally).
- Every HTTP Request and Send Email node: `retryOnFail: true`, `maxTries ≥ 3`, `waitBetweenTries ≥ 1000`. Both main workflows: `settings.errorWorkflow = "llErrorHandler001"`.
- Signing and verification JavaScript in Code nodes must implement exactly `` `${ts}.${METHOD}.${path}.${body}` ``, a 300-second window, `v1=` header parsing (several comma-separated values allowed) and a constant-time comparison. No `require('crypto')` in Code nodes: HMAC comes from the Crypto node.
- Responses from the n8n webhook: 401 `{"error":"unauthorized"}` for any verification failure, 200 `{"duplicate":true}` for repeated event IDs, 202 `{"accepted":true}` otherwise. Never echo payload data back.
- No secret ever appears in git, in workflow JSON, in logs, or in command output. Generated env files: `n8n/.env` (gitignored).
- Email copy: plain, functional English; no em dashes; first names only.

---

## File map

```
n8n/Dockerfile                     FROM n8nio/n8n:2.45.7 + workflows + entrypoint
n8n/entrypoint.sh                  render placeholders, import credentials (temp file, deleted), import + publish workflows, exec n8n
n8n/workflows/loan-notifications.json
n8n/workflows/overdue-reminders.json
n8n/workflows/error-handler.json
n8n/.env.example                   documented variables, no values
docker-compose.yml                 postgres, n8n (build ./n8n), mailpit
scripts/setup.ts                   generate secrets → n8n/.env, set Convex env vars; --rotate moves current to *_PREVIOUS
scripts/lib/envfile.ts             tiny .env reader/writer (tested)
convex/seed.ts                     internal demo seed (users, tools, an overdue loan); used by E2E and Plan 4
tests/n8n/workflows.test.ts        static lint of exported workflow JSON
tests/n8n/contract.test.ts         runs the Code nodes' jsCode against contracts/hmac-vectors.json
scripts/lib/envfile.test.ts
docs/superpowers/specs/2026-10-31-lendloop-design.md  (§15: record spike results)
package.json                       scripts: setup, stack:up, stack:down, seed, e2e:automation
```

---

### Task 1: Secret setup script and env file helper

**Files:** Create `scripts/lib/envfile.ts`, `scripts/lib/envfile.test.ts`, `scripts/setup.ts`, `n8n/.env.example`; modify `package.json`, `.gitignore` (ensure `n8n/.env`).

**Interfaces:** `parseEnv(text: string): Map<string, string>`, `serializeEnv(map: Map<string, string>, header?: string): string`, `randomSecret(bytes?: number): string` (hex, default 32 bytes). `pnpm setup` writes/updates `n8n/.env` and runs `convex env set` for `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `CONVEX_INBOUND_SECRET`, `APP_URL`, `APP_TIMEZONE` (keeps existing values unless `--rotate`).

- [ ] **Step 1: Failing tests for the env helper**

```ts
// scripts/lib/envfile.test.ts
import { expect, test } from "vitest";
import { parseEnv, randomSecret, serializeEnv } from "./envfile";

test("parses KEY=value lines, ignores comments and blanks, keeps = inside values", () => {
  const env = parseEnv("# c\nA=1\n\nB=x=y\n  C = spaced \n");
  expect([...env]).toEqual([["A", "1"], ["B", "x=y"], ["C", "spaced"]]);
});

test("serializes deterministically with an optional header", () => {
  expect(serializeEnv(new Map([["A", "1"], ["B", "2"]]), "# generated")).toBe("# generated\nA=1\nB=2\n");
});

test("randomSecret is hex of the requested size and unique", () => {
  const a = randomSecret();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(randomSecret()).not.toBe(a);
  expect(randomSecret(16)).toMatch(/^[0-9a-f]{32}$/);
});
```

Run `pnpm vitest run scripts/lib/envfile.test.ts` → FAIL.

- [ ] **Step 2: Implement `scripts/lib/envfile.ts`**

```ts
import { randomBytes } from "node:crypto";

export function parseEnv(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return env;
}

export function serializeEnv(env: Map<string, string>, header?: string): string {
  const lines = [...env].map(([key, value]) => `${key}=${value}`);
  return `${header ? `${header}\n` : ""}${lines.join("\n")}\n`;
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
```

Run the test → PASS.

- [ ] **Step 3: Implement `scripts/setup.ts`**

Behaviour (write the code accordingly; keep it under ~120 lines, no secret printed):
1. Read `n8n/.env` if present (`parseEnv`), else start empty.
2. Ensure keys, generating with `randomSecret()` only when missing (or when `--rotate` is passed for the two HMAC secrets, in which case copy the current value to `*_PREVIOUS` first):
   `N8N_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `LENDLOOP_N8N_WEBHOOK_SECRET` (Convex→n8n), `LENDLOOP_CONVEX_INBOUND_SECRET` (n8n→Convex), `N8N_OWNER_PASSWORD` (24 random bytes, base64url).
3. Fixed/default keys when missing: `N8N_INSTANCE_OWNER_EMAIL=owner@lendloop.local`, `N8N_INSTANCE_OWNER_FIRST_NAME=LendLoop`, `N8N_INSTANCE_OWNER_LAST_NAME=Owner`, `GENERIC_TIMEZONE=UTC`, `CONVEX_SITE_URL=http://host.docker.internal:3211`, `MAIL_FROM=LendLoop <no-reply@lendloop.local>`, `OPS_EMAIL=ops@lendloop.local`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_USER=`, `SMTP_PASS=`, `SMTP_SECURE=false`.
4. Compute `N8N_INSTANCE_OWNER_PASSWORD_HASH` with bcrypt (cost 10) from `N8N_OWNER_PASSWORD` whenever the password changes: run `docker run --rm -e PW n8nio/n8n:2.45.7 node -e "process.stdout.write(require('bcryptjs').hashSync(process.env.PW,10))"` with `PW` passed via env (never on the command line), or add `bcryptjs` as a devDependency and hash in-process (preferred if it installs cleanly; record the choice). Escape `$` in the hash for docker-compose env files by doubling it (`$$`) **only** if compose interpolation is used for that file; with `env_file:` no escaping is needed — verify in Task 3.
5. Write `n8n/.env` with header `# Generated by pnpm setup. Local secrets: never commit.` and mode `0600`.
6. Run `pnpm exec convex env set` for: `N8N_WEBHOOK_URL=http://localhost:5678/webhook/lendloop-loan-events`, `N8N_WEBHOOK_SECRET` (= `LENDLOOP_N8N_WEBHOOK_SECRET`), `CONVEX_INBOUND_SECRET` (= `LENDLOOP_CONVEX_INBOUND_SECRET`), the `_PREVIOUS` pair when rotating, `APP_URL=http://localhost:3000`, `APP_TIMEZONE` (= `GENERIC_TIMEZONE`). Pass values through `spawnSync` argument arrays (never a shell string), with `stdio: ["ignore", "ignore", "inherit"]` so values are not echoed.
7. Print only: which keys were created/rotated, the n8n owner email, and the path of the file holding the owner password.

- [ ] **Step 4: `n8n/.env.example`** — every key from Step 2–3 with an empty value and a one-line comment; no real values.

- [ ] **Step 5: package.json scripts**

```json
"setup": "tsx scripts/setup.ts",
"stack:up": "docker compose up -d --build",
"stack:down": "docker compose down",
"seed": "convex run seed:demo",
"e2e:automation": "tsx scripts/e2e-automation.ts"
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run scripts/lib/envfile.test.ts && pnpm setup && pnpm setup` (second run must report no changes) `&& git status --short` (no `n8n/.env` listed) `&& pnpm exec convex env list | cut -d= -f1` (names only).
Commit: `feat(n8n): add secret setup script and env helpers`.

---

### Task 2: n8n image, entrypoint and compose stack (spike-driven)

**Files:** Create `n8n/Dockerfile`, `n8n/entrypoint.sh`, `docker-compose.yml`, temporary `n8n/workflows/smoke.json` (deleted at the end of this task).

**Interfaces:** `docker compose up -d --build` starts `postgres` (healthy), `mailpit` (UI `localhost:8025`, SMTP `mailpit:1025` inside the network), `n8n` (`localhost:5678`), with credentials and workflows imported and published on every start (idempotent: same IDs overwrite).

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM n8nio/n8n:2.45.7
USER root
COPY --chown=node:node workflows /opt/lendloop/workflows
COPY --chown=node:node entrypoint.sh /opt/lendloop/entrypoint.sh
RUN chmod 0555 /opt/lendloop/entrypoint.sh
USER node
ENTRYPOINT ["/opt/lendloop/entrypoint.sh"]
```

- [ ] **Step 2: entrypoint.sh** (POSIX sh, `set -eu`), in order:
1. Fail fast if any required variable is empty: `N8N_ENCRYPTION_KEY LENDLOOP_N8N_WEBHOOK_SECRET LENDLOOP_CONVEX_INBOUND_SECRET CONVEX_SITE_URL MAIL_FROM OPS_EMAIL SMTP_HOST SMTP_PORT`.
2. `umask 077`; work dir `$(mktemp -d)`; `trap 'rm -rf "$WORK"' EXIT`.
3. Render workflows: for each `/opt/lendloop/workflows/*.json`, replace exactly `{{CONVEX_SITE_URL}}`, `{{MAIL_FROM}}`, `{{OPS_EMAIL}}` (use `node -e` with a small script that reads env and does `split/join`, not `sed`, to avoid escaping bugs) into `$WORK/workflows/`.
4. Write `$WORK/credentials.json` (array) with the three credentials (fixed IDs/names from Global Constraints): `crypto` `{ hmacSecret: LENDLOOP_N8N_WEBHOOK_SECRET }`, `crypto` `{ hmacSecret: LENDLOOP_CONVEX_INBOUND_SECRET }`, `smtp` `{ user, password, host, port: Number, secure: SMTP_SECURE === "true" }`, using `node -e` reading env (secrets never on argv).
5. `n8n import:credentials --input="$WORK/credentials.json"`; `rm -f "$WORK/credentials.json"` immediately.
6. `n8n import:workflow --separate --input="$WORK/workflows"`.
7. For each workflow id in the rendered files: `n8n publish:workflow --id=<id>`.
8. `exec n8n start`.

- [ ] **Step 3: docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: n8n
      POSTGRES_DB: n8n
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?run pnpm setup}
    volumes: [postgres-data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U n8n -d n8n"]
      interval: 5s
      retries: 10
  mailpit:
    image: axllent/mailpit:v1.27   # record the exact tag you pull
    ports: ["8025:8025"]
  n8n:
    build: ./n8n
    env_file: [./n8n/.env]
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: n8n
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
      N8N_INSTANCE_OWNER_MANAGED_BY_ENV: "true"
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "true"
      EXECUTIONS_DATA_SAVE_ON_SUCCESS: none
      EXECUTIONS_DATA_SAVE_ON_ERROR: all
      EXECUTIONS_DATA_MAX_AGE: "168"
      EXECUTIONS_DATA_PRUNE: "true"
      N8N_DIAGNOSTICS_ENABLED: "false"
      N8N_PERSONALIZATION_ENABLED: "false"
      N8N_VERSION_NOTIFICATIONS_ENABLED: "false"
      N8N_TEMPLATES_ENABLED: "false"
      N8N_PUBLIC_API_DISABLED: "true"
      N8N_SECURE_COOKIE: "false"   # local http only; true in production
    ports: ["5678:5678"]
    extra_hosts: ["host.docker.internal:host-gateway"]
    depends_on:
      postgres: { condition: service_healthy }
      mailpit: { condition: service_started }
volumes:
  postgres-data:
```

Compose reads `${POSTGRES_PASSWORD}` from a project `.env`; point it at `n8n/.env` with `docker compose --env-file n8n/.env` inside the `stack:up`/`stack:down` scripts (update package.json accordingly).

- [ ] **Step 4: Smoke workflow to settle the open questions**

Create `n8n/workflows/smoke.json` (id `llSmokeTest00001`): Webhook (POST `lendloop-smoke`, `responseMode: responseNode`, `options.rawBody: true`) → Code "Read raw body" → Crypto (HMAC SHA256 hex over `{{ $json.raw }}`, credential `llCryptoInbound01`) → Respond to Webhook (`respondWith: json`, body `={{ { raw: $('Read raw body').item.json.raw, hmac: $json.hmac } }}`).

In "Read raw body", try in order and keep the first that works under task runners:
```js
// A: helper (works with filesystem binary mode)
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
return [{ json: { raw: buf.toString('utf8') } }];
```
```js
// B: inline base64
return [{ json: { raw: Buffer.from($input.first().binary.data.data, 'base64').toString('utf8') } }];
```

Run `pnpm stack:up`, then from the host:
`curl -s -X POST localhost:5678/webhook/lendloop-smoke -H 'content-type: application/json' --data '{"tool":{"name":"Taladro ñandú"}}'`
Expected: `raw` equals the exact bytes sent, and `hmac` equals `node -e` HMAC of the same string with `LENDLOOP_N8N_WEBHOOK_SECRET` (compute locally reading `n8n/.env` without printing the secret; compare and print only `match: true|false`).

Also confirm: credentials imported encrypted (`docker compose exec n8n n8n export:credentials --all --output=/tmp/c.json && docker compose exec n8n sh -c 'grep -c hmacSecret /tmp/c.json; rm /tmp/c.json'` → 0, i.e. data not plaintext), the owner can log in at `localhost:5678` with the email from `n8n/.env` and the password from `N8N_OWNER_PASSWORD`, and the n8n logs show no env-access errors.

- [ ] **Step 5: Record and clean up**

Record the working raw-body approach, the credential import format, and the Mailpit tag in spec §15 (n8n row: `**Result: …**`). Delete `n8n/workflows/smoke.json`, `pnpm stack:down`. Commit: `feat(n8n): add n8n image, provisioning entrypoint and compose stack`.

---

### Task 3: Workflow `loan-notifications`

**Files:** Create `n8n/workflows/loan-notifications.json` (id `llLoanNotify0001`, `settings.errorWorkflow: "llErrorHandler001"`, `active` irrelevant: published by the entrypoint).

**Nodes (names are part of the contract; tests look them up):**
1. `Webhook` — POST `lendloop-loan-events`, `responseMode: responseNode`, `options.rawBody: true`.
2. `Build canonical string` (Code, run once for all items) — reads raw body (approach from Task 2), headers `x-lendloop-timestamp`, `x-lendloop-signature`, `x-lendloop-event-id`; outputs `{ canonical: ts + '.POST./webhook/lendloop-loan-events.' + raw, ts, provided: [hex...], eventId, raw }`. Path is the fixed webhook path, not taken from the request.
3. `Compute HMAC` (Crypto v2) — credential `llCryptoInbound01`, value `={{ $json.canonical }}`, `dataPropertyName: expected`, SHA256 hex.
4. `Verify signature` (Code) — constant-time compare of `expected` against each `provided`; `|now - ts| ≤ 300`; JSON-parse `raw`; outputs `{ valid: boolean, eventId, payload }` (payload only when valid).
5. `Valid?` (IF 2.2 on `{{ $json.valid }}` is true).
   - false → `Respond 401` (Respond to Webhook: json `{"error":"unauthorized"}`, `options.responseCode: 401`).
   - true → `Seen before?` (Remove Duplicates v2: `removeItemsSeenInPreviousExecutions`, `dedupeValue: ={{ $json.eventId }}`, `options.scope: workflow`). Kept items → `Respond 202` (`{"accepted":true}`, 202) → `Compose email` → `Send email` → `Prepare status write-back` → `Sign status write-back` (Crypto, credential `llCryptoOutbound1`) → `POST notification status` (HTTP Request). Items removed as duplicates: add a second branch by running `Seen before?` with `Keep Items Where` per the node's discard output if available; otherwise place a Code node `Was duplicate?` before it that queries nothing and instead use IF on `$('Seen before?').all().length === 0` to route to `Respond 200 duplicate`. Choose the simplest structure that the n8n version supports and that the E2E in Task 6 proves (a repeated event ID returns 200 `{"duplicate":true}` and sends no email).
6. `Compose email` (Code) — maps `payload.type` to subject + plain-text body using only `recipient.firstName`, `counterpartFirstName`, `tool.name`, `loan.startDate/endDate`, `actionUrl`. Subjects:
   - `loan.requested`: "{counterpart} wants to borrow your {tool}"
   - `loan.approved`: "Your request for the {tool} was approved"
   - `loan.declined`: "Your request for the {tool} was declined"
   - `loan.cancelled`: "A booking for the {tool} was cancelled"
   - `loan.handed_over`: "You have the {tool} until {endDate}"
   - `loan.returned`: "The {tool} was returned"
   - `loan.expired`: "A request for the {tool} expired"
   - `listing.removed`: "Your listing changed: {tool}"
   Body: greeting with first name, one sentence, the dates when a loan exists, the action link, sign-off "LendLoop". No em dashes.
7. `Send email` (emailSend 2.1, credential `llSmtp0000000001`, `fromEmail: {{MAIL_FROM}}`, `toEmail: ={{ $json.to }}`, text format, `retryOnFail: true, maxTries: 5, waitBetweenTries: 5000`).
8. `Prepare status write-back` (Code) — body `JSON.stringify({ eventId, status: 'sent', executionId: $execution.id })`, `ts`, canonical `ts + '.POST./n8n/notifications/status.' + body`.
9. `Sign status write-back` (Crypto, `llCryptoOutbound1`, `dataPropertyName: signature`).
10. `POST notification status` (HTTP Request 4.2) — `{{CONVEX_SITE_URL}}/n8n/notifications/status`, headers `content-type: application/json`, `x-lendloop-timestamp`, `x-lendloop-signature: v1=<signature>`, raw JSON body = the exact prepared string (use "Send Body: Raw / application/json" so n8n does not re-serialize), `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000`.

- [ ] Steps: author JSON → `pnpm stack:up` → send a signed request with a fake payload addressed to `test@example.com` (sign with `LENDLOOP_N8N_WEBHOOK_SECRET` from `n8n/.env` via a tsx one-off; status write-back will 404 for a fake event ID; that is fine here) → expect 202, an email in Mailpit (`curl -s localhost:8025/api/v1/messages | jq '.messages[0].Subject'`), and 401 for a tampered body and for a stale timestamp → commit `feat(n8n): add signed loan notification workflow`.

---

### Task 4: Workflows `overdue-reminders` and `error-handler`

**Files:** Create `n8n/workflows/overdue-reminders.json` (id `llOverdueRemind01`, errorWorkflow `llErrorHandler001`), `n8n/workflows/error-handler.json` (id `llErrorHandler001`).

**`overdue-reminders` nodes:**
1. `Every day at 09:00` (Schedule Trigger 1.2, daily 09:00, uses `GENERIC_TIMEZONE`).
2. `Prepare overdue request` (Code) — ts, canonical `ts + '.GET./n8n/overdue-loans.'`.
3. `Sign overdue request` (Crypto, `llCryptoOutbound1`).
4. `GET overdue loans` (HTTP Request, `{{CONVEX_SITE_URL}}/n8n/overdue-loans`, signed headers, retry 3×/2000 ms).
5. `One item per loan` (Split Out on `loans`; zero loans → workflow ends without error).
6. `Compose reminder` (Code) — subject "Reminder: please return the {tool}", body with first name, "It was due on {endDate}" and days overdue, polite ask to arrange the return, sign-off.
7. `Send reminder` (emailSend, retry 5×/5000 ms, **On Error: continue (using error output)**).
8. Success path → `Mark sent` (Code: `status: 'sent'`); error output → `Mark failed` (Code: `status: 'failed'`, `error` = sanitized message without emails, max 300 chars). Both → `Prepare reminder write-back` (Code: body `{ loanId, idempotencyKey, status, executionId: $execution.id, error? }`, canonical for `POST /n8n/reminders`) → `Sign reminder write-back` (Crypto) → `POST reminder status` (HTTP Request, retry 3×).

**`error-handler` nodes:**
1. `Error Trigger`.
2. `Sanitize error` (Code) — `{ workflow: $json.workflow.name, executionId: String($json.execution?.id ?? $json.trigger?.... ?? Date.now()), node: $json.execution?.lastNodeExecuted, message: (error message) with emails replaced by "[email]", max 500 chars, eventId: execution data is not available here, so leave it undefined }`, then canonical for `POST /n8n/automation-errors`.
3. `Sign error report` (Crypto, `llCryptoOutbound1`).
4. `POST automation error` (HTTP Request, retry 3×, **On Error: continue (error output)**).
5. Error output → `Email ops` (emailSend to `{{OPS_EMAIL}}`, subject "LendLoop automation failure", body with workflow, node and execution id only).

- [ ] Steps: author both → `pnpm stack:up` → run `docker compose exec n8n n8n execute --id=llOverdueRemind01` with Convex local running and `pnpm setup` applied (expect `{ loans: [] }` path to finish cleanly) → commit `feat(n8n): add overdue reminder and error handler workflows`.

---

### Task 5: Workflow lint and contract tests

**Files:** Create `tests/n8n/workflows.test.ts`, `tests/n8n/contract.test.ts`.

- [ ] **Step 1: `tests/n8n/workflows.test.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const DIR = fileURLToPath(new URL("../../n8n/workflows", import.meta.url));
type Node = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string } & Record<string, unknown>>;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
};
type Workflow = { id: string; name: string; nodes: Node[]; settings?: { errorWorkflow?: string } };

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const workflows = files.map((f) => ({ file: f, raw: readFileSync(join(DIR, f), "utf8") }));
const parsed = workflows.map((w) => ({ ...w, json: JSON.parse(w.raw) as Workflow }));

const SECRET_PATTERNS = [/[0-9a-f]{40,}/i, /whsec_/, /sk_(test|live)_/, /pk_(test|live)_/, /"password"\s*:\s*"[^"{]/i, /hmacSecret/];
const ALLOWED_PLACEHOLDERS = new Set(["{{CONVEX_SITE_URL}}", "{{MAIL_FROM}}", "{{OPS_EMAIL}}"]);

test("exactly the three LendLoop workflows are exported", () => {
  expect(parsed.map((w) => w.json.id).sort()).toEqual(["llErrorHandler001", "llLoanNotify0001", "llOverdueRemind01"]);
});

describe.each(parsed)("$file", ({ raw, json }) => {
  test("contains no secrets or credential data", () => {
    for (const pattern of SECRET_PATTERNS) expect(raw, String(pattern)).not.toMatch(pattern);
    for (const node of json.nodes) {
      for (const ref of Object.values(node.credentials ?? {})) expect(Object.keys(ref).sort()).toEqual(["id", "name"]);
    }
  });

  test("only allowlisted placeholders", () => {
    const found = raw.match(/\{\{[A-Z_]+\}\}/g) ?? [];
    for (const placeholder of found) expect(ALLOWED_PLACEHOLDERS.has(placeholder), placeholder).toBe(true);
  });

  test("network and email nodes retry", () => {
    for (const node of json.nodes.filter((n) => /httpRequest|emailSend/.test(n.type))) {
      expect(node.retryOnFail, node.name).toBe(true);
      expect(node.maxTries ?? 0, node.name).toBeGreaterThanOrEqual(3);
      expect(node.waitBetweenTries ?? 0, node.name).toBeGreaterThanOrEqual(1000);
    }
  });

  test("Code nodes do not require node builtins", () => {
    for (const node of json.nodes.filter((n) => n.type === "n8n-nodes-base.code")) {
      expect(String(node.parameters.jsCode), node.name).not.toMatch(/require\(/);
    }
  });
});

test("main workflows route failures to the error handler", () => {
  for (const id of ["llLoanNotify0001", "llOverdueRemind01"]) {
    expect(parsed.find((w) => w.json.id === id)?.json.settings?.errorWorkflow).toBe("llErrorHandler001");
  }
});

test("the webhook keeps the raw body for signature checks", () => {
  const notify = parsed.find((w) => w.json.id === "llLoanNotify0001")!.json;
  const webhook = notify.nodes.find((n) => n.type === "n8n-nodes-base.webhook")!;
  expect(webhook.parameters).toMatchObject({ path: "lendloop-loan-events", responseMode: "responseNode", options: { rawBody: true } });
});
```

- [ ] **Step 2: `tests/n8n/contract.test.ts`** — load `loan-notifications.json`, take the `jsCode` of `Build canonical string` and `Verify signature`, and run each with a small harness (`new AsyncFunction("$input", "$json", "$", "$execution", "Buffer", "helpers", code)` or `node:vm` with those globals) that mimics the n8n item API used by the code (`$input.first()`, `$input.all()`, `this.helpers.getBinaryDataBuffer` if used). For each vector in `contracts/hmac-vectors.json` whose `path` is `/webhook/lendloop-loan-events`:
  - canonical output equals `` `${timestamp}.POST./webhook/lendloop-loan-events.${body}` ``;
  - with `expected` = the vector signature and `provided` header `v1=<signature>` and `now` within the window → `valid: true`;
  - tampered body, wrong signature, missing header, and timestamp 301 s old → `valid: false`.
  Also run `Prepare status write-back` from the same file and `Prepare reminder write-back` / `Prepare overdue request` from `overdue-reminders.json`, asserting their canonical strings match `contracts/hmac-vectors.json`'s format for `/n8n/notifications/status`, `/n8n/reminders` and `GET /n8n/overdue-loans` (empty body). Use `vi.useFakeTimers()` / `vi.setSystemTime()` to pin `Date.now()` for the window check.
- [ ] **Step 3:** `pnpm test` → PASS. Commit `test(n8n): lint exported workflows and verify Code nodes against shared vectors`.

---

### Task 6: Demo seed and end-to-end automation run

**Files:** Create `convex/seed.ts` (internalMutation `demo`), `scripts/e2e-automation.ts`; modify spec §15.

- [ ] **Step 1: `convex/seed.ts`** — `export const demo = internalMutation({ args: {}, handler })` that is idempotent (no-op if a user with `clerkId: "seed_marta"` exists). Creates fictional neighbours (`Marta Rodríguez`, `Joaquín Pérez`, `Ana López`) with `@example.com` emails and `tokenIdentifier: "seed|<id>"` (they cannot sign in), 8 tools across categories, and loans: one pending, one approved for next week, one active and overdue (endDate 3 days before `today()`), one returned. Uses `applyLoanTransition`-free direct inserts plus audit rows `actorType: "system", action: "seed"` so the timeline is not empty. Internal functions are not callable from clients; it only runs via `npx convex run` with deploy access.
- [ ] **Step 2: `scripts/e2e-automation.ts`** (tsx; requires `pnpm dev:convex` running and `pnpm stack:up`): 
  1. `convex run seed:demo`.
  2. Clear Mailpit (`DELETE localhost:8025/api/v1/messages`).
  3. Create two test identities with `npx convex run --identity '<json>' users:syncMe`, a tool for one, and a request from the other (`loans:request` with dates 2 days ahead).
  4. Poll Mailpit up to 30 s for a message to the owner's email with subject containing "wants to borrow"; poll Convex (`npx convex run --identity <admin json with role admin> admin:automationHealth`) until `counts.sent ≥ 1`.
  5. Re-deliver the same event ID (sign and POST the same payload again to n8n) → expect HTTP 200 `{"duplicate":true}` and no new Mailpit message.
  6. Execute reminders: `docker compose --env-file n8n/.env exec n8n n8n execute --id=llOverdueRemind01`; expect a Mailpit message "Reminder: please return …" to the seeded overdue borrower and a `reminders` row (`admin:automationHealth` → `reminders24h.sent ≥ 1`). Execute again → no new email (idempotent).
  7. Failure path: `docker compose stop mailpit`, create another request, wait ≤ 90 s for `automationHealth.errors.length ≥ 1` (error workflow reported to Convex) or the outbox event to reach `failed`; `docker compose start mailpit`.
  8. Print a short PASS/FAIL table; exit 1 on any failure. Never print secrets or full emails (mask with the same rule as `maskEmail`).
- [ ] **Step 3:** run it until green; record in spec §15 (n8n row) what was verified. Commit `test(e2e): verify notifications, dedupe, reminders and error path against local n8n`.

---

## Plan 2b exit criteria

- `pnpm setup && pnpm stack:up && pnpm dev:convex` brings up a working local stack with zero manual n8n clicks.
- `pnpm test` includes passing workflow lint and contract tests.
- `pnpm e2e:automation` passes: email on request, duplicate suppressed, reminders sent once per day, failures visible in Convex.
- No secret in git (`git grep -nE "[0-9a-f]{40,}|whsec_|sk_test_"` only matches test fixtures).
