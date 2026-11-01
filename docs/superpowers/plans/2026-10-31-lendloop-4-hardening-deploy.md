# LendLoop Plan 4: Hardening, Docs, CI and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining security gaps, prove the app end to end in a browser, document every decision, add CI, and ship the public demo (GitHub public repo, Vercel, Convex production, Railway n8n, Resend email on a subdomain of `aido.lat`).

**Architecture:** No new subsystems. Hardening touches the n8n image/workflows and `next.config.ts`; verification adds Playwright UI tests; docs live in `README.md` + `docs/`; deployment follows spec §12 with the decisions below.

**Decisions (user, 2026-10-31):** public GitHub repo under account `S-kkipie`; production email through **Resend** with a sending subdomain of `aido.lat` (DNS on Cloudflare, Resend account exists); deploy accounts exist for **Vercel, Railway and Convex**, operated through the user's debug Chrome when a browser step is needed. Single light theme. Clerk stays a development instance (production instance needs an owned app domain; documented in production.md).

**Spec:** `docs/superpowers/specs/2026-10-31-lendloop-design.md` §8, §10–§16.

## Global Constraints

- Never print, log or commit secrets; secrets move between tools through env/stdin/files with mode 0600 that are deleted after use. Before the first push, scan the full history with gitleaks and stop on any finding.
- Outward-facing actions (creating the public repo, pushing, creating cloud projects, adding DNS records, spending money) happen only in the tasks below, in order, after the previous task is verified. Anything that costs money beyond Railway's usage plan requires an explicit user OK.
- Production Convex never has `ALLOW_DEV_TOOLS`; production n8n has `N8N_SECURE_COOKIE=true`; production `APP_URL` is the Vercel URL.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: n8n must-fix follow-ups (spec §16)

- [ ] **Zero-downtime rotation (Convex→n8n):** add credential `llCryptoInboundPrev` "LendLoop: Convex→n8n HMAC (previous)" fed from `LENDLOOP_N8N_WEBHOOK_SECRET_PREVIOUS` (entrypoint falls back to the current secret when the previous one is empty). In `loan-notifications`, compute both HMACs (second Crypto node) and accept either in `Verify signature` (constant time for both). `scripts/setup.ts --rotate` already writes `_PREVIOUS`; make sure it also writes the n8n side. Extend `tests/n8n/contract.test.ts`: a request signed with the previous secret verifies; one signed with neither fails.
- [ ] **Stale workflows:** in `entrypoint.sh`, before importing, list existing workflow IDs (`n8n export:workflow --all --output=<tmp>` then read ids) and `n8n unpublish:workflow --id=<id>` every ID not shipped in the image. Prove it by importing a dummy workflow, restarting, and checking it is no longer active.
- [ ] **Dedupe cap:** keep n8n dedupe for the demo, set `historySize` explicitly to 10000 in the node (visible decision), and document the production fix in `docs/production.md` (Task 6).
- [ ] Run `pnpm e2e:automation` again (must stay all PASS). Commit `fix(n8n): accept the previous webhook secret during rotation and retire stale workflows`.

### Task 2: Security headers

- [ ] In `next.config.ts` `headers()` for all routes: `Content-Security-Policy` (default-src 'self'; script-src 'self' 'unsafe-inline' plus the Clerk Frontend API origin and `https://challenges.cloudflare.com`; connect-src 'self' plus the Convex URL (https and wss) and the Clerk origin; img-src 'self' data: https://img.clerk.com; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'), `Strict-Transport-Security` (production only), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment all `()`), `X-Frame-Options: DENY`. Build origins from env (`NEXT_PUBLIC_CONVEX_URL`, Clerk publishable key decoded to its Frontend API host) so local and production both work. Follow Clerk's CSP guide (read it first; record its URL) and the Next 16 docs in node_modules.
- [ ] Verify with `pnpm build && pnpm start` + browser: sign-in modal, Convex websocket, Paper shader, toasts all work with zero CSP violations in the console; `curl -sI localhost:3000 | grep -iE "content-security|strict|x-frame|referrer|permissions"`. Nonce-based CSP is documented as the production follow-up. Commit `feat(security): add CSP and security headers`.

### Task 3: Browser end-to-end tests (Playwright + Clerk testing + axe)

- [ ] Add `@playwright/test`, `@clerk/testing`, `@axe-core/playwright` (dev). `playwright.config.ts` runs against `pnpm dev:next` + `pnpm dev:convex` (webServer), Chromium only, `e2e/` dir.
- [ ] Global setup: `clerkSetup()`; create (or reuse) two Clerk test users through the Backend API with `+clerk_test` emails and generated passwords kept only in memory/env for the run: `e2e-owner`, `e2e-borrower`; delete them in teardown. Data cleanup through `devtools:purgeE2E` (clerkIds will not start with `e2e_`, so extend purge to accept an explicit list of clerkIds, guarded the same way).
- [ ] Specs: (1) public landing shows tools with name and category only, no owner names anywhere in the DOM, axe has no serious/critical violations; (2) owner lists a tool; borrower requests dates; owner sees it in Incoming and approves; borrower's timeline shows Approved; axe on browse, detail, incoming, timeline; (3) a non-admin cannot see the Admin nav item and `/admin` shows "Admins only"; (4) keyboard: ⌘K opens the palette and navigates.
- [ ] `pnpm e2e` script; document prerequisites in the README. Commit `test(e2e): add Playwright flows with Clerk testing tokens and axe checks`.

### Task 4: CI

- [ ] `.github/workflows/ci.yml` on push/PR: pnpm 12 + Node 24 setup with cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm docs:authz --check`, `pnpm build` (with a syntactically valid dummy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CONVEX_URL`), gitleaks (`gitleaks/gitleaks-action` or the gitleaks binary with `--redact`). E2E is not in CI (needs Clerk and the stack); say so in the README.
- [ ] `.github/dependabot.yml` (npm weekly, GitHub Actions weekly). `.gitleaks.toml` allowlisting only the test fixtures (`contracts/hmac-vectors.json` test secret, the fake `whsec_` in tests/plans).
- [ ] Run gitleaks locally over the full history (`docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo --redact`); must be clean. Commit `ci: add checks, secret scanning and dependabot`.

### Task 5: Demo account and screenshots

- [ ] Create a Clerk dev user "Demo Admin" (`demo-admin@<sending subdomain>` or `+clerk_test` address, strong generated password stored only in a 0600 file under the scratchpad, `publicMetadata.role = "admin"`) and a "Demo Neighbour" (no role). Credentials go to the user privately for the submission email, never into the repo.
- [ ] `pnpm db:reset-demo`, sign in as Demo Admin in a fresh browser context, create the demo state (tools, requests, an active loan, an overdue loan, a sent reminder, one dead letter), and capture README screenshots at 1280×800: landing, browse, tool detail with calendar, incoming with conflict warning, loan timeline with automation entries, admin automation tab. Save to `docs/screenshots/*.png` (optimized, no real personal data visible). Commit `docs: add product screenshots`.

### Task 6: Documentation

- [ ] `README.md`: what LendLoop is (one paragraph + tagline), screenshots, live demo link and test accounts note ("credentials in the submission email"), quickstart (prereqs; `pnpm install`; Clerk setup steps incl. session claims; `pnpm setup:local`; `pnpm stack:up`; `pnpm dev`; `pnpm seed`), scripts table, environment variables table (where each lives: Next/Vercel, Convex, n8n/Railway; secret or not), architecture diagram (mermaid), how automation works (two sequence diagrams), security and data-minimization summary with links, testing (unit, convex-test, authz matrix, workflow contract, automation E2E, Playwright), production note summary + link, repo map.
- [ ] `docs/architecture.md` (components, trust boundaries, data flow, both workflows as mermaid sequence diagrams, failure handling), `docs/security.md` (STRIDE-lite threat model table mapped to the exact files/tests that mitigate each threat; RBAC model; secrets handling; webhook signing; rate limits; CSP; logging redaction; known limitations), `docs/pii-map.md` (every personal field: where stored, who sees it, sent to n8n?, logs?, retention, deletion behaviour), `docs/integration.md` (contract v1 with payload examples, headers, canonical string, rotation, idempotency keys, retries/backoff/dead letters, error workflow, heartbeat, failure-mode table, how to replay), `docs/adr/0001-…` to `0010-…` (one per decision D1–D13 grouped sensibly; context, decision, consequences, ~150 words each), `docs/runbook.md` (rotate secrets, replay dead letters, stale heartbeat, n8n down, Resend bounce, reset local demo), `docs/production.md` (the requested production note: Clerk prod instance + domain, secret manager + rotation, nonce CSP, n8n queue mode + workers + backups, dedupe moved into Convex, log drain + Sentry + uptime monitor on `/health` and heartbeat, retention/purge jobs, GDPR export/delete, rate-limit tuning, pentest, tenancy, cost notes).
- [ ] Keep `docs/superpowers/` (design spec and plans) as the decision record and link it from the README ("How this was built"). Commit `docs: add README, architecture, security, PII map, integration, ADRs, runbook and production note`.

### Task 7: Publish the repository

- [ ] Final local checks: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm docs:authz --check`; gitleaks over full history clean; `git grep` for the author's personal email returns nothing outside git metadata.
- [ ] `gh repo create S-kkipie/lendloop --public --source . --remote origin --description "Neighbourhood tool-lending board: Next.js, Clerk, Convex and n8n with signed webhooks, RBAC and automated reminders."` then `git push -u origin main`. Confirm CI is green on GitHub.

### Task 8: Production deployment

Each step verified before the next. Record every URL (not secrets) in `docs/production.md` "Live demo" section.

- [ ] **Resend:** add domain `lendloop.aido.lat` in Resend; add its DNS records (SPF TXT, DKIM, MX/return-path as Resend lists) in Cloudflare for `aido.lat` through the user's browser (or Resend's Cloudflare auto-configure); wait for "Verified". Create a sending-only API key scoped to that domain. SMTP for n8n: host `smtp.resend.com`, port 465, secure true, user `resend`, password = API key; `MAIL_FROM="LendLoop <no-reply@lendloop.aido.lat>"`.
- [ ] **Convex production:** `npx convex login` (device flow in the user's browser), create project `lendloop`, `npx convex deploy`; set prod env vars: `CLERK_JWT_ISSUER_DOMAIN`, `APP_URL` (Vercel URL), `APP_TIMEZONE`, `N8N_WEBHOOK_URL` (Railway n8n URL + `/webhook/lendloop-loan-events`), `N8N_WEBHOOK_SECRET`, `CONVEX_INBOUND_SECRET` (fresh production secrets, generated once, passed via stdin), `CLERK_WEBHOOK_SIGNING_SECRET` (after the Clerk webhook step). No `ALLOW_DEV_TOOLS`.
- [ ] **Railway:** install `@railway/cli` (or use the dashboard), new project `lendloop` with a Postgres plugin and a service built from `n8n/Dockerfile` (root `n8n/`); variables: all n8n env from `n8n/.env.example` with production values (fresh secrets, owner email = user's choice, owner password hash, `CONVEX_SITE_URL` = Convex prod `.convex.site` URL, Resend SMTP, `N8N_SECURE_COOKIE=true`, `WEBHOOK_URL`/`N8N_WEBHOOK_URL` = public Railway URL, DB vars from the Postgres plugin); generate a public domain; verify the owner login and that the three workflows are active.
- [ ] **Vercel:** import the GitHub repo; env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (a new production-use secret key from the Clerk dev instance, named `vercel`), `CONVEX_DEPLOY_KEY` (production deploy key), `NEXT_PUBLIC_REPO_URL`; build command `npx convex deploy --cmd 'pnpm build'`; deploy; set `APP_URL` in Convex to the final URL.
- [ ] **Clerk:** add the Vercel domain to allowed origins if required; add webhook endpoint `<convex .site URL>/clerk/webhook` for `user.updated` and `user.deleted`; put its signing secret into Convex prod env; send a test event and confirm 200.
- [ ] **Seed and smoke test production:** `npx convex run seed:demo --prod`; sign in as Demo Admin on the live URL; request a tool as Demo Neighbour; confirm the Resend email arrives (to an address the user controls), the outbox shows `sent`, admin automation tab is healthy; run the reminders workflow once manually on Railway and confirm the heartbeat updates.
- [ ] Commit the "Live demo" section and any doc updates; push; confirm CI green and Vercel production build green.

## Plan 4 exit criteria

- Spec §16 must-fix items closed; CSP active with no violations; Playwright suite passes locally; CI green on GitHub; public repo with README, docs, screenshots; live demo reachable with working email, n8n workflows, and an admin demo account handed to the user privately.

## Execution split (parallel)

- **Stream A** (main checkout, branch `feat/hardening`, owns the running servers): Task 1 → Task 2 → Task 3 → Task 4, plus two small UI follow-ups from the Plan 3 QA: the landing's live count renders "0" until hydration (render the real server count in the HTML and only animate on the client), and nothing else.
- **Stream B** (git worktree `../lendloop-docs`, branch `feat/docs`, no servers): Task 6 docs. Leave clearly marked `<!-- TODO(live): … -->` slots only for the live demo URL and the screenshot images, which the lead fills in Tasks 5 and 8.
- **Lead**: Task 5 (demo account + screenshots), Task 7 (publish), Task 8 (deploy) after both streams merge.
- Known behaviour to document (from Plan 3 QA): replaying the same failed notification twice emails the recipient twice, because each replay is a new event ID by design; the admin UI warns before a second replay.
