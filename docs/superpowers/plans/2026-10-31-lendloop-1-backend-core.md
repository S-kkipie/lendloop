# LendLoop Plan 1: Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the LendLoop repo and build the fully tested Convex backend core: schema, pure domain model, authorization wrappers, users/tools/loans/admin APIs, audit log, outbox enqueue, rate limits, expiry cron, and a generated authorization matrix.

**Architecture:** Next.js 16 App Router shell with Convex as the only enforcement point. Pure domain logic lives in `convex/model/` (no Convex imports) and is unit-tested; every public Convex function is built from wrappers in `convex/lib/functions.ts` that resolve the viewer from the Clerk token. Every loan state change goes through `applyLoanTransition`, which patches, audits and enqueues outbox events in one transaction. Delivery of outbox events to n8n is Plan 2.

**Tech Stack:** Next.js 16.4, React 19, TypeScript (strict), Convex 1.49 (local anonymous deployment for dev), convex-helpers 0.1.133, @convex-dev/rate-limiter 0.4.3, Clerk (`@clerk/nextjs` 7), Vitest 5 + convex-test 0.0.66 + @edge-runtime/vm, pnpm, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-31-lendloop-design.md` (sections 3, 4, 5, 6, 8 rate limits, 10, 12 are implemented here).

**Plan series:** 1 Backend core (this) → 2 Automation (HMAC, outbox delivery, HTTP endpoints, n8n, compose) → 3 UI (Ledger direction) → 4 Hardening, docs, CI, deploy.

## Global Constraints

- Package manager: `pnpm`. Node 24. TypeScript `strict: true`.
- Pinned majors: `next@16.4.x`, `convex@1.49.x`, `@clerk/nextjs@7.x`, `convex-helpers@0.1.133`, `@convex-dev/rate-limiter@0.4.3`, `convex-test@0.0.66`, `vitest@5.x`, `@edge-runtime/vm@5.x`.
- Only `convex/lib/functions.ts` may import `query`, `mutation`, `action`, `internalQuery`, `internalMutation`, `internalAction` or `httpAction` from `_generated/server`. Everything else imports wrappers from `convex/lib/functions.ts`. Types (`QueryCtx`, `MutationCtx`, …) may be imported anywhere.
- `publicQuery` is used exactly once: `tools.listPublic`.
- Errors: `ConvexError({ code, message })` with `code ∈ UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | INVALID | RATE_LIMITED`. A resource the caller cannot see → `NOT_FOUND`; visible but action not allowed → `FORBIDDEN`.
- Role: `identity.role === "admin" ? "admin" : "user"`. Role is never stored in the database.
- Dates: `"YYYY-MM-DD"` strings, `endDate` inclusive, "today" computed in `APP_TIMEZONE` (default `UTC`).
- `auditLog` and `outboxEvents` store IDs only; no names, emails or messages.
- Other users see a display name (first name + last initial). Public functions return no user data.
- Limits: tool name 3–60, description ≤ 500, borrower message ≤ 300, removal reason 3–200, loan range ≤ 30 days. Rate limits: `loanRequest` 10/hour/user, `toolCreate` 20/day/user.
- Commit messages: Conventional Commits, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Convex files with more than one dot in the name (`*.test.ts`, `test.helpers.ts`) are test-only and must never be imported by deployed code.

---

## File map (created by this plan)

```
package.json, tsconfig.json, vitest.config.ts, eslint.config.mjs, .env.example
app/layout.tsx, app/page.tsx, app/ConvexClientProvider.tsx, proxy.ts        (Task 1, Task 13)
convex/convex.config.ts                       rate limiter component
convex/auth.config.ts                         Clerk issuer (Task 13)
convex/schema.ts
convex/model/dates.ts        + dates.test.ts
convex/model/overlap.ts      + overlap.test.ts
convex/model/loanMachine.ts  + loanMachine.test.ts
convex/lib/errors.ts
convex/lib/validators.ts
convex/lib/config.ts
convex/lib/displayName.ts    + displayName.test.ts
convex/lib/functions.ts
convex/lib/audit.ts
convex/lib/rateLimits.ts
convex/lib/tools.ts          tool helpers (availability, cascade removal, field cleaning)
convex/lib/loanAccess.ts     party resolution + loan summaries
convex/lib/loanTransitions.ts + loanTransitions.test.ts
convex/automation/outbox.ts  enqueueEvent (delivery scheduling added in Plan 2)
convex/users.ts              + users.test.ts
convex/tools.ts              + tools.test.ts
convex/loans.ts              + loans.request.test.ts, loans.lifecycle.test.ts, loans.queries.test.ts, loans.expiry.test.ts
convex/admin.ts              + admin.test.ts
convex/crons.ts
convex/authz.test.ts
convex/test.helpers.ts
tests/authz/matrix.ts
tests/static/wrappers.test.ts
tests/static/authzCoverage.test.ts
scripts/authz-matrix.ts
docs/authz-matrix.md         (generated)
```

---

### Task 1: Scaffold Next.js + Convex + test toolchain

**Files:**
- Create: Next.js scaffold files (copied from a temp dir), `vitest.config.ts`, `convex/model/smoke.test.ts` (deleted in Task 3), `.env.example`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Produces: `pnpm test` (Vitest projects `convex` [edge-runtime, `convex/**/*.test.ts`] and `node` [node, `tests/**/*.test.ts`, `scripts/**/*.test.ts`]), `pnpm typecheck`, `pnpm lint`, `pnpm convex:push` (pushes to the local anonymous deployment and regenerates `convex/_generated`).

- [ ] **Step 1: Scaffold Next.js into a temp dir and copy it in**

The repo already has `.gitignore`, `design/`, `docs/`, so scaffold elsewhere and copy without overwriting `.gitignore`:

```bash
SCAFFOLD=$(mktemp -d)/lendloop
pnpm dlx create-next-app@16.4.3 "$SCAFFOLD" --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --skip-install --yes
rsync -a --exclude .git --exclude .gitignore --exclude README.md "$SCAFFOLD"/ ./
cat "$SCAFFOLD/.gitignore" >> .gitignore
```

If a flag is rejected by this create-next-app version, drop that flag (the `--yes` defaults are acceptable) and rerun.

- [ ] **Step 2: De-duplicate `.gitignore`**

Run: `awk '!seen[$0]++' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore`
Expected: the original LendLoop entries (`.env.*`, `!.env.example`, `n8n/.env`, `.impeccable/`, …) are still present; `grep -c '^\.env' .gitignore` ≥ 1.

- [ ] **Step 3: Install runtime and dev dependencies**

```bash
pnpm install
pnpm add convex@1.49 @clerk/nextjs@7 convex-helpers@0.1.133 @convex-dev/rate-limiter@0.4.3
pnpm add -D vitest@5 convex-test@0.0.66 @edge-runtime/vm@5 tsx npm-run-all2
```

- [ ] **Step 4: Initialize the Convex local anonymous deployment**

```bash
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --once
```

Expected: creates `convex/` (with `_generated/`, `tsconfig.json`, `README.md`) and writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` (`http://127.0.0.1:3210`) to `.env.local`. Delete `convex/README.md`.

- [ ] **Step 5: Turn on strictness and scripts**

Ensure `tsconfig.json` has `"strict": true` (create-next-app sets it). Replace the `scripts` block in `package.json` with:

```json
{
  "scripts": {
    "dev": "run-p dev:next dev:convex",
    "dev:next": "next dev",
    "dev:convex": "convex dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p . && tsc --noEmit -p convex",
    "test": "vitest run",
    "test:watch": "vitest",
    "convex:push": "convex dev --once",
    "docs:authz": "tsx scripts/authz-matrix.ts"
  }
}
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "node",
          include: ["tests/**/*.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
```

- [ ] **Step 7: Write a smoke test**

`convex/model/smoke.test.ts`:

```ts
import { expect, test } from "vitest";

test("toolchain runs in edge-runtime", () => {
  expect(typeof crypto.subtle.sign).toBe("function");
});
```

- [ ] **Step 8: Write `.env.example`**

```bash
# Next.js (filled by `convex dev` for local; Vercel env in production)
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
CONVEX_DEPLOYMENT=

# Clerk (Plan 1 Task 13)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Convex deployment env vars are set with `npx convex env set NAME value`, not here:
#   CLERK_JWT_ISSUER_DOMAIN, APP_TIMEZONE, APP_URL (Plan 2 adds the automation secrets)
```

- [ ] **Step 9: Run the checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 1 test passes (project `convex`); typecheck and lint exit 0. If `tsc -p convex` complains about `import.meta.glob` later, that is handled in Task 5.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16, Convex local deployment and Vitest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spike: Convex local deployment can reach localhost

Throwaway check for spec §15 risk #1. Nothing from this task is kept except a note.

**Files:**
- Create then delete: `convex/spike.ts`
- Modify: `docs/superpowers/specs/2026-10-31-lendloop-design.md` (§15 row 1: record the result)

- [ ] **Step 1: Start a dummy server on port 5678**

Run (background): `python3 -m http.server 5678 --bind 127.0.0.1`

- [ ] **Step 2: Write the spike action**

`convex/spike.ts` (temporarily imports the raw builder; deleted in Step 4):

```ts
import { internalAction } from "./_generated/server";

export const ping = internalAction({
  args: {},
  handler: async () => {
    const res = await fetch("http://localhost:5678/");
    return { status: res.status };
  },
});
```

- [ ] **Step 3: Push and run it**

Run: `pnpm convex:push && pnpm exec convex run spike:ping`
Expected: `{ "status": 200 }`. If it fails with a network or blocked-address error, also try `http://127.0.0.1:5678/` and record which works.

- [ ] **Step 4: Clean up and record the result**

Stop the Python server. Delete `convex/spike.ts`, run `pnpm convex:push`. In the spec §15 table, append to the first row's Spike cell: `**Result 2026-10-31: works (http://localhost:5678)**` or `**Result: blocked → use self-hosted Convex in compose**` as observed. If blocked, stop and tell the user before Plan 2.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-31-lendloop-design.md convex/_generated
git commit -m "docs: record Convex local deployment localhost fetch spike result

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure domain model (dates, overlap, loan state machine)

**Files:**
- Create: `convex/model/dates.ts`, `convex/model/overlap.ts`, `convex/model/loanMachine.ts`
- Test: `convex/model/dates.test.ts`, `convex/model/overlap.test.ts`, `convex/model/loanMachine.test.ts`
- Delete: `convex/model/smoke.test.ts`

**Interfaces:**
- Produces (no Convex imports in any of these files):
  - `dates.ts`: `isIsoDate(value: string): boolean`, `todayIn(timeZone: string, now?: number): string`, `addDays(date: string, days: number): string`, `daysInclusive(startDate: string, endDate: string): number`, `isOverdue(loan: {status: string; endDate: string}, today: string): boolean`, `daysOverdue(endDate: string, today: string): number`, `isValidTimeZone(tz: string): boolean`, `type RangeProblem = "invalid_format" | "end_before_start" | "starts_in_past" | "too_long"`, `checkRequestedRange(startDate: string, endDate: string, today: string, maxDays: number): RangeProblem | null`
  - `overlap.ts`: `interface DateRange { startDate: string; endDate: string }`, `rangesOverlap(a: DateRange, b: DateRange): boolean`, `overlapping<T extends DateRange>(target: DateRange, candidates: T[]): T[]`
  - `loanMachine.ts`: `LOAN_STATUSES` (readonly tuple), `type LoanStatus`, `type LoanAction = "approve" | "decline" | "cancel" | "handOver" | "markReturned" | "expire" | "closeForListingRemoval" | "closeForAccountDeletion"`, `type LoanActor = "owner" | "borrower" | "system"`, `nextStatus(from: LoanStatus, action: LoanAction, actor: LoanActor): LoanStatus | null`, `TERMINAL_STATUSES: readonly LoanStatus[]`, `BLOCKING_STATUSES: readonly LoanStatus[]` (`approved`, `active`), `isTerminal(status: LoanStatus): boolean`, `type NextStep = "owner_decision" | "handover" | "return" | null`, `nextStep(status: LoanStatus): NextStep`

- [ ] **Step 1: Write failing tests for dates**

`convex/model/dates.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  addDays,
  checkRequestedRange,
  daysInclusive,
  daysOverdue,
  isIsoDate,
  isOverdue,
  isValidTimeZone,
  todayIn,
} from "./dates";

describe("isIsoDate", () => {
  test.each([
    ["2026-11-05", true],
    ["2026-02-28", true],
    ["2026-02-30", false],
    ["2026-1-05", false],
    ["05/11/2026", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe("todayIn", () => {
  const now = Date.parse("2026-11-06T02:30:00Z");
  test("UTC", () => expect(todayIn("UTC", now)).toBe("2026-11-06"));
  test("behind UTC rolls back a day", () => expect(todayIn("America/New_York", now)).toBe("2026-11-05"));
  test("ahead of UTC", () => expect(todayIn("Asia/Tokyo", now)).toBe("2026-11-06"));
});

test("addDays crosses month and year boundaries", () => {
  expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});

test("daysInclusive counts both ends", () => {
  expect(daysInclusive("2026-11-05", "2026-11-05")).toBe(1);
  expect(daysInclusive("2026-11-05", "2026-11-07")).toBe(3);
});

describe("isOverdue", () => {
  test("not overdue on the end date itself", () => {
    expect(isOverdue({ status: "active", endDate: "2026-11-05" }, "2026-11-05")).toBe(false);
  });
  test("overdue the day after", () => {
    expect(isOverdue({ status: "active", endDate: "2026-11-05" }, "2026-11-06")).toBe(true);
  });
  test("only active loans can be overdue", () => {
    expect(isOverdue({ status: "approved", endDate: "2026-11-05" }, "2026-11-06")).toBe(false);
  });
});

test("daysOverdue", () => {
  expect(daysOverdue("2026-11-05", "2026-11-05")).toBe(0);
  expect(daysOverdue("2026-11-05", "2026-11-08")).toBe(3);
});

test("isValidTimeZone", () => {
  expect(isValidTimeZone("America/Santiago")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
});

describe("checkRequestedRange", () => {
  const today = "2026-11-02";
  test.each([
    ["2026-11-05", "2026-11-07", null],
    ["2026-11-02", "2026-11-02", null],
    ["2026-11-5", "2026-11-07", "invalid_format"],
    ["2026-11-07", "2026-11-05", "end_before_start"],
    ["2026-11-01", "2026-11-03", "starts_in_past"],
    ["2026-11-05", "2026-12-05", "too_long"],
    ["2026-11-05", "2026-12-04", null],
  ] as const)("%s..%s → %s", (start, end, expected) => {
    expect(checkRequestedRange(start, end, today, 30)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run convex/model/dates.test.ts`
Expected: FAIL, cannot resolve `./dates`.

- [ ] **Step 3: Implement `convex/model/dates.ts`**

```ts
// Pure date helpers. Dates are "YYYY-MM-DD" strings; endDate is inclusive.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayIn(timeZone: string, now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInclusive(startDate: string, endDate: string): number {
  const span = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(span / DAY_MS) + 1;
}

export function isOverdue(loan: { status: string; endDate: string }, today: string): boolean {
  return loan.status === "active" && today > loan.endDate;
}

export function daysOverdue(endDate: string, today: string): number {
  return Math.max(0, daysInclusive(endDate, today) - 1);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type RangeProblem = "invalid_format" | "end_before_start" | "starts_in_past" | "too_long";

export function checkRequestedRange(
  startDate: string,
  endDate: string,
  today: string,
  maxDays: number,
): RangeProblem | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return "invalid_format";
  if (endDate < startDate) return "end_before_start";
  if (startDate < today) return "starts_in_past";
  if (daysInclusive(startDate, endDate) > maxDays) return "too_long";
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run convex/model/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for overlap**

`convex/model/overlap.test.ts`:

```ts
import { expect, test } from "vitest";
import { overlapping, rangesOverlap } from "./overlap";

const r = (startDate: string, endDate: string) => ({ startDate, endDate });

test.each([
  [r("2026-11-05", "2026-11-07"), r("2026-11-07", "2026-11-09"), true], // shared end day
  [r("2026-11-05", "2026-11-07"), r("2026-11-08", "2026-11-09"), false], // adjacent
  [r("2026-11-05", "2026-11-10"), r("2026-11-06", "2026-11-07"), true], // contained
  [r("2026-11-06", "2026-11-06"), r("2026-11-05", "2026-11-07"), true], // single day inside
])("rangesOverlap(%o, %o) → %s", (a, b, expected) => {
  expect(rangesOverlap(a, b)).toBe(expected);
  expect(rangesOverlap(b, a)).toBe(expected);
});

test("overlapping filters candidates", () => {
  const candidates = [
    { id: 1, ...r("2026-11-01", "2026-11-04") },
    { id: 2, ...r("2026-11-04", "2026-11-06") },
    { id: 3, ...r("2026-11-09", "2026-11-12") },
  ];
  expect(overlapping(r("2026-11-05", "2026-11-08"), candidates).map((c) => c.id)).toEqual([2]);
});
```

- [ ] **Step 6: Run to verify it fails, then implement `convex/model/overlap.ts`**

Run: `pnpm vitest run convex/model/overlap.test.ts` → FAIL (module missing). Then:

```ts
export interface DateRange {
  startDate: string;
  endDate: string;
}

// Inclusive ranges overlap when each starts on or before the other ends.
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function overlapping<T extends DateRange>(target: DateRange, candidates: T[]): T[] {
  return candidates.filter((candidate) => rangesOverlap(target, candidate));
}
```

Run again → PASS.

- [ ] **Step 7: Write failing tests for the state machine**

`convex/model/loanMachine.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  LOAN_STATUSES,
  TERMINAL_STATUSES,
  isTerminal,
  nextStatus,
  nextStep,
  type LoanAction,
  type LoanActor,
  type LoanStatus,
} from "./loanMachine";

const ACTIONS: LoanAction[] = [
  "approve",
  "decline",
  "cancel",
  "handOver",
  "markReturned",
  "expire",
  "closeForListingRemoval",
  "closeForAccountDeletion",
];
const ACTORS: LoanActor[] = ["owner", "borrower", "system"];

describe("allowed transitions", () => {
  test.each([
    ["pending", "approve", "owner", "approved"],
    ["pending", "decline", "owner", "declined"],
    ["pending", "decline", "system", "declined"],
    ["pending", "cancel", "borrower", "cancelled"],
    ["approved", "cancel", "borrower", "cancelled"],
    ["approved", "cancel", "owner", "cancelled"],
    ["approved", "handOver", "owner", "active"],
    ["active", "markReturned", "owner", "returned"],
    ["pending", "expire", "system", "expired"],
    ["approved", "expire", "system", "expired"],
    ["pending", "closeForListingRemoval", "system", "cancelled"],
    ["approved", "closeForListingRemoval", "system", "cancelled"],
    ["pending", "closeForAccountDeletion", "system", "cancelled"],
    ["approved", "closeForAccountDeletion", "system", "cancelled"],
  ] as const)("%s --%s(%s)--> %s", (from, action, actor, to) => {
    expect(nextStatus(from, action, actor)).toBe(to);
  });
});

describe("rejected transitions", () => {
  test.each([
    ["pending", "approve", "borrower"],
    ["approved", "approve", "owner"],
    ["approved", "decline", "owner"],
    ["pending", "cancel", "owner"],
    ["active", "cancel", "borrower"],
    ["active", "cancel", "owner"],
    ["pending", "handOver", "owner"],
    ["approved", "handOver", "borrower"],
    ["active", "markReturned", "borrower"],
    ["approved", "markReturned", "owner"],
    ["active", "expire", "system"],
    ["active", "closeForListingRemoval", "system"],
    ["pending", "expire", "owner"],
  ] as const)("%s --%s(%s)--> null", (from, action, actor) => {
    expect(nextStatus(from, action, actor)).toBeNull();
  });

  test("terminal statuses never transition", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const action of ACTIONS) {
        for (const actor of ACTORS) {
          expect(nextStatus(from, action, actor), `${from}/${action}/${actor}`).toBeNull();
        }
      }
    }
  });
});

test("terminal set", () => {
  const terminal: LoanStatus[] = ["returned", "declined", "cancelled", "expired"];
  for (const status of LOAN_STATUSES) {
    expect(isTerminal(status)).toBe(terminal.includes(status));
  }
});

test("nextStep", () => {
  expect(nextStep("pending")).toBe("owner_decision");
  expect(nextStep("approved")).toBe("handover");
  expect(nextStep("active")).toBe("return");
  expect(nextStep("returned")).toBeNull();
});
```

- [ ] **Step 8: Run to verify it fails, then implement `convex/model/loanMachine.ts`**

Run: `pnpm vitest run convex/model/loanMachine.test.ts` → FAIL. Then:

```ts
// Pure loan state machine: (status, action, actor) → next status.
export const LOAN_STATUSES = [
  "pending",
  "approved",
  "active",
  "returned",
  "declined",
  "cancelled",
  "expired",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export type LoanAction =
  | "approve"
  | "decline"
  | "cancel"
  | "handOver"
  | "markReturned"
  | "expire"
  | "closeForListingRemoval"
  | "closeForAccountDeletion";

export type LoanActor = "owner" | "borrower" | "system";

interface Rule {
  from: readonly LoanStatus[];
  actor: LoanActor;
  to: LoanStatus;
}

const RULES: Record<LoanAction, readonly Rule[]> = {
  approve: [{ from: ["pending"], actor: "owner", to: "approved" }],
  decline: [
    { from: ["pending"], actor: "owner", to: "declined" },
    { from: ["pending"], actor: "system", to: "declined" }, // auto-decline: dates taken
  ],
  cancel: [
    { from: ["pending", "approved"], actor: "borrower", to: "cancelled" },
    { from: ["approved"], actor: "owner", to: "cancelled" },
  ],
  handOver: [{ from: ["approved"], actor: "owner", to: "active" }],
  markReturned: [{ from: ["active"], actor: "owner", to: "returned" }],
  expire: [{ from: ["pending", "approved"], actor: "system", to: "expired" }],
  closeForListingRemoval: [{ from: ["pending", "approved"], actor: "system", to: "cancelled" }],
  closeForAccountDeletion: [{ from: ["pending", "approved"], actor: "system", to: "cancelled" }],
};

export function nextStatus(from: LoanStatus, action: LoanAction, actor: LoanActor): LoanStatus | null {
  const rule = RULES[action].find((r) => r.actor === actor && r.from.includes(from));
  return rule ? rule.to : null;
}

export const TERMINAL_STATUSES: readonly LoanStatus[] = ["returned", "declined", "cancelled", "expired"];
export const BLOCKING_STATUSES: readonly LoanStatus[] = ["approved", "active"];

export function isTerminal(status: LoanStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type NextStep = "owner_decision" | "handover" | "return" | null;

export function nextStep(status: LoanStatus): NextStep {
  if (status === "pending") return "owner_decision";
  if (status === "approved") return "handover";
  if (status === "active") return "return";
  return null;
}
```

Run again → PASS.

- [ ] **Step 9: Delete the smoke test and run the whole suite**

Run: `rm convex/model/smoke.test.ts && pnpm test`
Expected: all model tests pass.

- [ ] **Step 10: Commit**

```bash
git add convex/model
git commit -m "feat(model): add pure date, overlap and loan state machine logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Schema, validators, errors and config

**Files:**
- Create: `convex/lib/errors.ts`, `convex/lib/validators.ts`, `convex/lib/config.ts`, `convex/schema.ts`
- Test: `convex/schema.test.ts`, `convex/lib/config.test.ts`

**Interfaces:**
- Consumes: `LOAN_STATUSES` from `convex/model/loanMachine.ts`; `isValidTimeZone`, `todayIn` from `convex/model/dates.ts`.
- Produces:
  - `errors.ts`: `type ErrorCode`, `appError(code: ErrorCode, message: string): ConvexError<{ code: ErrorCode; message: string }>`
  - `validators.ts`: `CATEGORIES`, `CONDITIONS`, `CLOSE_REASONS`, `EVENT_TYPES`, `OUTBOX_STATUSES` (readonly tuples); validators `vCategory`, `vCondition`, `vLoanStatus`, `vCloseReason`, `vEventType`, `vOutboxStatus`, `vActorType`, `vEntityType`; types `Category`, `Condition`, `CloseReason`, `EventType`, `OutboxStatus`, `ActorType`, `EntityType`; `LIMITS`
  - `config.ts`: `appTimeZone(): string`, `today(): string`
  - `schema.ts`: tables `users`, `tools`, `loans`, `outboxEvents`, `reminders`, `automationErrors`, `automationHeartbeats`, `auditLog` exactly as below.

- [ ] **Step 1: Implement `convex/lib/errors.ts`**

```ts
import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "RATE_LIMITED";

export function appError(code: ErrorCode, message: string) {
  return new ConvexError({ code, message });
}
```

- [ ] **Step 2: Implement `convex/lib/validators.ts`**

```ts
import { v, type Infer } from "convex/values";
import { literals } from "convex-helpers/validators";
import { LOAN_STATUSES } from "../model/loanMachine";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders",
  "other",
] as const;
export const CONDITIONS = ["new", "like_new", "good", "fair"] as const;
export const CLOSE_REASONS = [
  "owner_declined",
  "dates_taken",
  "listing_removed",
  "borrower_cancelled",
  "owner_cancelled",
  "account_deleted",
  "not_handed_over",
  "start_passed",
] as const;
export const EVENT_TYPES = [
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.handed_over",
  "loan.returned",
  "loan.expired",
  "listing.removed",
] as const;
export const OUTBOX_STATUSES = [
  "pending",
  "retrying",
  "delivered",
  "sent",
  "failed",
  "dead",
  "skipped",
] as const;

export const vCategory = literals(...CATEGORIES);
export const vCondition = literals(...CONDITIONS);
export const vLoanStatus = literals(...LOAN_STATUSES);
export const vCloseReason = literals(...CLOSE_REASONS);
export const vEventType = literals(...EVENT_TYPES);
export const vOutboxStatus = literals(...OUTBOX_STATUSES);
export const vActorType = literals("user", "admin", "system", "n8n");
export const vEntityType = literals("loan", "tool", "user", "outboxEvent", "automationError");
export const vToolStatus = literals("listed", "removed");

export type Category = Infer<typeof vCategory>;
export type Condition = Infer<typeof vCondition>;
export type CloseReason = Infer<typeof vCloseReason>;
export type EventType = Infer<typeof vEventType>;
export type OutboxStatus = Infer<typeof vOutboxStatus>;
export type ActorType = Infer<typeof vActorType>;
export type EntityType = Infer<typeof vEntityType>;

export const LIMITS = {
  toolNameMin: 3,
  toolNameMax: 60,
  descriptionMax: 500,
  messageMax: 300,
  removalReasonMin: 3,
  removalReasonMax: 200,
  maxLoanDays: 30,
} as const;

// Re-exported so callers need one import for validators.
export { v };
```

- [ ] **Step 3: Implement `convex/lib/config.ts`**

```ts
import { isValidTimeZone, todayIn } from "../model/dates";

export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE;
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

export function today(): string {
  return todayIn(appTimeZone());
}
```

- [ ] **Step 4: Implement `convex/schema.ts`**

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vActorType,
  vCategory,
  vCloseReason,
  vCondition,
  vEntityType,
  vEventType,
  vLoanStatus,
  vOutboxStatus,
  vToolStatus,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    isTrustedLender: v.boolean(),
    trustedAt: v.optional(v.number()),
    trustedBy: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    status: vToolStatus,
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_status_category", ["status", "category"])
    .index("by_owner", ["ownerId"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: vLoanStatus,
    closeReason: v.optional(vCloseReason),
    approvedAt: v.optional(v.number()),
    handedOverAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status_endDate", ["status", "endDate"])
    .index("by_status_startDate", ["status", "startDate"]),

  outboxEvents: defineTable({
    type: vEventType,
    schemaVersion: v.literal(1),
    loanId: v.optional(v.id("loans")),
    toolId: v.optional(v.id("tools")),
    recipientId: v.id("users"),
    status: vOutboxStatus,
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    replayOf: v.optional(v.id("outboxEvents")),
  })
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"]),

  reminders: defineTable({
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    n8nExecutionId: v.string(),
    error: v.optional(v.string()),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  automationErrors: defineTable({
    workflow: v.string(),
    executionId: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    eventId: v.optional(v.id("outboxEvents")),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
  })
    .index("by_executionId", ["executionId"])
    .index("by_resolved", ["resolvedAt"]),

  automationHeartbeats: defineTable({
    workflow: v.literal("overdue-reminders"),
    lastCheckInAt: v.number(),
  }).index("by_workflow", ["workflow"]),

  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    actorType: vActorType,
    action: v.string(),
    entityType: vEntityType,
    entityId: v.string(),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    reason: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_time", ["at"]),
});
```

- [ ] **Step 5: Write failing schema and config tests**

`convex/schema.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

test("schema accepts a valid tool and rejects an unknown category", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      tokenIdentifier: "https://clerk.test|user_a",
      clerkId: "user_a",
      name: "Alice Moreno",
      email: "alice@example.com",
      isTrustedLender: false,
    });
    await ctx.db.insert("tools", {
      ownerId,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "",
      status: "listed",
      updatedAt: Date.now(),
    });
    await expect(
      ctx.db.insert("tools", {
        ownerId,
        name: "Spaceship",
        // @ts-expect-error invalid category on purpose
        category: "spaceships",
        condition: "good",
        description: "",
        status: "listed",
        updatedAt: Date.now(),
      }),
    ).rejects.toThrow();
  });
});
```

`convex/lib/config.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { appTimeZone, today } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("defaults to UTC and ignores invalid zones", () => {
  vi.stubEnv("APP_TIMEZONE", "");
  expect(appTimeZone()).toBe("UTC");
  vi.stubEnv("APP_TIMEZONE", "Mars/Olympus");
  expect(appTimeZone()).toBe("UTC");
});

test("today() uses APP_TIMEZONE", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T02:30:00Z"));
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  expect(today()).toBe("2026-11-05");
});
```

- [ ] **Step 6: Push schema, run tests**

Run: `pnpm convex:push && pnpm test`
Expected: push succeeds (schema validated by the local backend); all tests PASS. If `schema.test.ts` shows the insert did not throw, confirm convex-test validates on insert for this version and, if not, replace that assertion with a check that `vCategory` rejects via `t.mutation` in Task 7 instead (note it in the commit).

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/schema.test.ts convex/lib convex/_generated
git commit -m "feat(convex): add schema, shared validators, typed errors and timezone config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Authorization wrappers, users API, test helpers, wrapper enforcement

**Files:**
- Create: `convex/lib/functions.ts`, `convex/lib/displayName.ts`, `convex/users.ts`, `convex/test.helpers.ts`, `tests/static/wrappers.test.ts`
- Modify: `eslint.config.mjs`
- Test: `convex/lib/displayName.test.ts`, `convex/users.test.ts`

**Interfaces:**
- Consumes: `appError`, `ErrorCode` (Task 4).
- Produces:
  - `functions.ts`: `type Role = "admin" | "user"`, `parseRole(claim: unknown): Role`, `publicQuery`, `identityMutation` (ctx gains `identity: UserIdentity`; used only by `users.syncMe`), `userQuery`, `userMutation`, `adminQuery`, `adminMutation` (ctx gains `user: Doc<"users">`, `role: Role`), and re-exports `internalQuery`, `internalMutation`, `internalAction`, `httpAction`. Type `ViewerCtx = { user: Doc<"users">; role: Role }`.
  - `displayName.ts`: `displayName(fullName: string): string`, `firstName(fullName: string): string`, `maskEmail(email: string | null): string | null`
  - `users.ts`: `syncMe` (mutation, `{}` → `Id<"users">`), `me` (query, `{}` → `{ id, displayName, email, role, isTrustedLender }`)
  - `test.helpers.ts`: `people` (identities `alice`, `bob`, `carol`, `dana`; `dana` has `role: "admin"`), `type Person`, `setupTest()`, `type TestT`, `signIn(t, who) → { as, id }`, `expectCode(promise, code)`, `NOW` (= `Date.parse("2026-11-02T12:00:00Z")`)

- [ ] **Step 1: Write failing displayName tests**

`convex/lib/displayName.test.ts`:

```ts
import { expect, test } from "vitest";
import { displayName, firstName, maskEmail } from "./displayName";

test("displayName shows first name and last initial", () => {
  expect(displayName("Marta Rodríguez")).toBe("Marta R.");
  expect(displayName("  Ana  María   López ")).toBe("Ana L.");
  expect(displayName("Prince")).toBe("Prince");
  expect(displayName("   ")).toBe("Neighbour");
});

test("firstName", () => {
  expect(firstName("Marta Rodríguez")).toBe("Marta");
  expect(firstName("")).toBe("Neighbour");
});

test("maskEmail keeps first letter and domain", () => {
  expect(maskEmail("marta@example.com")).toBe("m***@example.com");
  expect(maskEmail(null)).toBeNull();
  expect(maskEmail("broken")).toBe("***");
});
```

- [ ] **Step 2: Run to verify fail, implement `convex/lib/displayName.ts`, run to pass**

```ts
// How other people see a user: never the full name, never the email.
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Neighbour";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "Neighbour";
}

export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.charAt(0)}***${email.slice(at)}`;
}
```

Run: `pnpm vitest run convex/lib/displayName.test.ts` → PASS.

- [ ] **Step 3: Implement `convex/lib/functions.ts`**

```ts
// The only file allowed to import raw function builders. Every public Convex
// function is built from these wrappers so authentication and roles are
// resolved the same way everywhere.
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { UserIdentity } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";

export type Role = "admin" | "user";
export type ViewerCtx = { user: Doc<"users">; role: Role };

export function parseRole(claim: unknown): Role {
  return claim === "admin" ? "admin" : "user";
}

async function requireIdentity(ctx: QueryCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Sign in required");
  return identity;
}

async function loadViewer(ctx: QueryCtx): Promise<ViewerCtx> {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user || user.deletedAt !== undefined) {
    throw appError("UNAUTHENTICATED", "Account not ready");
  }
  return { user, role: parseRole(identity.role) };
}

async function loadAdmin(ctx: QueryCtx): Promise<ViewerCtx> {
  const viewer = await loadViewer(ctx);
  if (viewer.role !== "admin") throw appError("FORBIDDEN", "Admins only");
  return viewer;
}

// Allowlisted: used only by tools.listPublic (enforced by tests/static/wrappers.test.ts).
export const publicQuery = query;

// Used only by users.syncMe, which must run before the users row exists.
export const identityMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ identity: await requireIdentity(ctx) })),
);

export const userQuery = customQuery(query, customCtx(async (ctx) => loadViewer(ctx)));
export const userMutation = customMutation(mutation, customCtx(async (ctx) => loadViewer(ctx)));
export const adminQuery = customQuery(query, customCtx(async (ctx) => loadAdmin(ctx)));
export const adminMutation = customMutation(mutation, customCtx(async (ctx) => loadAdmin(ctx)));

export { httpAction, internalAction, internalMutation, internalQuery };
```

- [ ] **Step 4: Implement `convex/users.ts`**

```ts
import { appError } from "./lib/errors";
import { displayName } from "./lib/displayName";
import { identityMutation, userQuery } from "./lib/functions";

export const syncMe = identityMutation({
  args: {},
  handler: async (ctx) => {
    const { identity } = ctx;
    const composed = [identity.givenName, identity.familyName].filter(Boolean).join(" ");
    const name = (identity.name ?? composed).trim() || "Neighbour";
    const email = typeof identity.email === "string" ? identity.email : null;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.deletedAt !== undefined) throw appError("FORBIDDEN", "Account deleted");
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      name,
      email,
      isTrustedLender: false,
    });
  },
});

export const me = userQuery({
  args: {},
  handler: async (ctx) => ({
    id: ctx.user._id,
    displayName: displayName(ctx.user.name),
    email: ctx.user.email, // the viewer's own email only
    role: ctx.role,
    isTrustedLender: ctx.user.isTrustedLender,
  }),
});
```

- [ ] **Step 5: Push to regenerate `_generated/api`**

Run: `pnpm convex:push`
Expected: success; `convex/_generated/api.d.ts` now contains `users`.

- [ ] **Step 6: Implement `convex/test.helpers.ts`**

```ts
/// <reference types="vite/client" />
// Test-only helpers (two dots in the filename: never deployed).
import { convexTest } from "convex-test";
import type { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "./_generated/api";
import type { ErrorCode } from "./lib/errors";
import schema from "./schema";

export const modules = import.meta.glob("./**/!(*.*.*)*.*s");

const issuer = "https://clerk.test";
const identity = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  subject: id,
  issuer,
  tokenIdentifier: `${issuer}|${id}`,
  name,
  email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  ...extra,
});

export const people = {
  alice: identity("user_alice", "Alice Moreno"),
  bob: identity("user_bob", "Bob Keller"),
  carol: identity("user_carol", "Carol Diaz"),
  dana: identity("user_dana", "Dana Okafor", { role: "admin" }),
} as const;
export type Person = keyof typeof people;

export const NOW = Date.parse("2026-11-02T12:00:00Z");

export function setupTest() {
  const t = convexTest(schema, modules);
  return t;
}
export type TestT = ReturnType<typeof setupTest>;

export async function signIn(t: TestT, who: Person) {
  const as = t.withIdentity(people[who]);
  const id = await as.mutation(api.users.syncMe, {});
  return { as, id };
}

export async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} but the call succeeded`).toBeDefined();
  const data = (caught as ConvexError<{ code: string }>).data;
  expect(data?.code, String(caught)).toBe(code);
}
```

- [ ] **Step 7: Write failing users tests**

`convex/users.test.ts`:

```ts
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { expectCode, people, setupTest, signIn } from "./test.helpers";

test("syncMe requires a token", async () => {
  const t = setupTest();
  await expectCode(t.mutation(api.users.syncMe, {}), "UNAUTHENTICATED");
});

test("syncMe creates once, then updates name and email", async () => {
  const t = setupTest();
  const first = await signIn(t, "alice");
  const again = await first.as.mutation(api.users.syncMe, {});
  expect(again).toBe(first.id);

  const renamed = t.withIdentity({ ...people.alice, name: "Alice Romero", email: "a.romero@example.com" });
  await renamed.mutation(api.users.syncMe, {});
  const row = await t.run((ctx) => ctx.db.get(first.id));
  expect(row?.name).toBe("Alice Romero");
  expect(row?.email).toBe("a.romero@example.com");
});

test("me exposes display name and role from the token", async () => {
  const t = setupTest();
  const alice = await signIn(t, "alice");
  const dana = await signIn(t, "dana");
  expect(await alice.as.query(api.users.me, {})).toMatchObject({ displayName: "Alice M.", role: "user" });
  expect(await dana.as.query(api.users.me, {})).toMatchObject({ role: "admin" });
});

test("unknown role claims get least privilege", async () => {
  const t = setupTest();
  const weird = t.withIdentity({ ...people.carol, role: "superuser" });
  await weird.mutation(api.users.syncMe, {});
  expect(await weird.query(api.users.me, {})).toMatchObject({ role: "user" });
});

test("me before syncMe, or after deletion, is unauthenticated", async () => {
  const t = setupTest();
  await expectCode(t.withIdentity(people.bob).query(api.users.me, {}), "UNAUTHENTICATED");

  const bob = await signIn(t, "bob");
  await t.run((ctx) => ctx.db.patch(bob.id, { deletedAt: Date.now() }));
  await expectCode(bob.as.query(api.users.me, {}), "UNAUTHENTICATED");
});
```

- [ ] **Step 8: Run users tests**

Run: `pnpm vitest run convex/users.test.ts`
Expected: PASS. If `expectCode` fails because convex-test wraps errors so `.data` is a JSON string, change `expectCode` to `const raw = (caught as ConvexError<unknown>).data; const data = typeof raw === "string" ? JSON.parse(raw) : raw;` and rerun.

- [ ] **Step 9: Write the static wrapper test**

`tests/static/wrappers.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const CONVEX_DIR = fileURLToPath(new URL("../../convex", import.meta.url));
const BUILDERS = new Set([
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction",
]);
const RAW_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.?\/)+_generated\/server["']/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const deployedFiles = walk(CONVEX_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => !f.includes(`${join("convex", "_generated")}`))
  .filter((f) => relative(CONVEX_DIR, f).split("/").pop()!.split(".").length === 2);

test("only lib/functions.ts imports raw function builders", () => {
  const offenders: string[] = [];
  for (const file of deployedFiles) {
    const rel = relative(CONVEX_DIR, file);
    if (rel === join("lib", "functions.ts")) continue;
    for (const match of readFileSync(file, "utf8").matchAll(RAW_IMPORT)) {
      const names = match[1]
        .split(",")
        .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
        .filter(Boolean);
      for (const name of names) if (BUILDERS.has(name)) offenders.push(`${rel}: ${name}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("publicQuery is used only by tools.listPublic", () => {
  const uses: string[] = [];
  for (const file of deployedFiles) {
    const rel = relative(CONVEX_DIR, file);
    if (rel === join("lib", "functions.ts")) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/export const (\w+) = publicQuery\(/g)) {
      uses.push(`${rel}:${match[1]}`);
    }
  }
  // Until Task 7 adds tools.listPublic this list is empty; afterwards it must be exactly this.
  expect(uses.filter((u) => u !== "tools.ts:listPublic")).toEqual([]);
});
```

- [ ] **Step 10: Add the ESLint restriction**

In `eslint.config.mjs`, append this object to the exported config array:

```js
{
  files: ["convex/**/*.ts"],
  ignores: ["convex/lib/functions.ts", "convex/_generated/**", "convex/**/*.*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/_generated/server"],
            importNames: [
              "query",
              "mutation",
              "action",
              "internalQuery",
              "internalMutation",
              "internalAction",
              "httpAction",
            ],
            message: "Build Convex functions with the wrappers in convex/lib/functions.ts.",
          },
        ],
      },
    ],
  },
},
```

- [ ] **Step 11: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. If `tsc -p convex` reports `import.meta.glob` missing types, add `"types": ["vite/client"]` to `convex/tsconfig.json` `compilerOptions`.

- [ ] **Step 12: Commit**

```bash
git add convex eslint.config.mjs tests
git commit -m "feat(auth): add authorization wrappers, users API and wrapper enforcement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Audit log, outbox enqueue, rate limiter, loan transition helper

**Files:**
- Create: `convex/convex.config.ts`, `convex/lib/audit.ts`, `convex/lib/rateLimits.ts`, `convex/automation/outbox.ts`, `convex/lib/loanTransitions.ts`
- Modify: `convex/test.helpers.ts` (register rate limiter; add `seedWorld`, `insertLoan`)
- Test: `convex/lib/loanTransitions.test.ts`

**Interfaces:**
- Consumes: `nextStatus`, `isTerminal`, `LoanAction`, `LoanActor`, `LoanStatus` (Task 3); validators types (Task 4).
- Produces:
  - `audit.ts`: `audit(ctx: MutationCtx, entry: { actorId?: Id<"users">; actorType: ActorType; action: string; entityType: EntityType; entityId: string; fromStatus?: string; toStatus?: string; reason?: string }): Promise<void>`
  - `rateLimits.ts`: `rateLimiter`, `type LimitName = "loanRequest" | "toolCreate"`, `enforceLimit(ctx: MutationCtx, name: LimitName, key: string): Promise<void>` (throws `RATE_LIMITED`)
  - `automation/outbox.ts`: `enqueueEvent(ctx: MutationCtx, event: { type: EventType; recipientId: Id<"users">; loanId?: Id<"loans">; toolId?: Id<"tools"> }): Promise<Id<"outboxEvents">>` — inserts `{ status: "pending", attempts: 0, schemaVersion: 1 }`. Plan 2 adds scheduling of delivery inside this function.
  - `loanTransitions.ts`: `type Notify = { type: EventType; recipientId: Id<"users"> }`, `applyLoanTransition(ctx: MutationCtx, input: { loan: Doc<"loans">; action: LoanAction; actor: LoanActor; actorId?: Id<"users">; actorType: ActorType; closeReason?: CloseReason; notify: Notify[] }): Promise<LoanStatus>` (throws `CONFLICT` when the machine rejects)
  - `test.helpers.ts` additions: `seedWorld(t) → { alice, bob, carol, dana, toolId }`, `insertLoan(t, world, fields?) → Id<"loans">` (defaults: borrower bob, `2026-11-05`..`2026-11-07`, status `pending`)

- [ ] **Step 1: Add the rate limiter component**

`convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);

export default app;
```

Run: `pnpm convex:push` → `components.rateLimiter` appears in `_generated/api.d.ts`.

- [ ] **Step 2: Implement `convex/lib/rateLimits.ts`**

```ts
import { DAY, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  loanRequest: { kind: "token bucket", rate: 10, period: HOUR, capacity: 10 },
  toolCreate: { kind: "token bucket", rate: 20, period: DAY, capacity: 20 },
});

export type LimitName = "loanRequest" | "toolCreate";

export async function enforceLimit(ctx: MutationCtx, name: LimitName, key: string): Promise<void> {
  const { ok } = await rateLimiter.limit(ctx, name, { key });
  if (!ok) throw appError("RATE_LIMITED", "Too many attempts. Try again later.");
}
```

- [ ] **Step 3: Implement `convex/lib/audit.ts` and `convex/automation/outbox.ts`**

`convex/lib/audit.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ActorType, EntityType } from "./validators";

// Append-only: there is intentionally no update or delete helper for auditLog.
export async function audit(
  ctx: MutationCtx,
  entry: {
    actorId?: Id<"users">;
    actorType: ActorType;
    action: string;
    entityType: EntityType;
    entityId: string;
    fromStatus?: string;
    toStatus?: string;
    reason?: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
```

`convex/automation/outbox.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { EventType } from "../lib/validators";

// Stores IDs only. The payload (with the recipient's email) is built at send
// time by the delivery action (Plan 2), which also gets scheduled here.
export async function enqueueEvent(
  ctx: MutationCtx,
  event: { type: EventType; recipientId: Id<"users">; loanId?: Id<"loans">; toolId?: Id<"tools"> },
): Promise<Id<"outboxEvents">> {
  return await ctx.db.insert("outboxEvents", {
    ...event,
    schemaVersion: 1,
    status: "pending",
    attempts: 0,
  });
}
```

- [ ] **Step 4: Implement `convex/lib/loanTransitions.ts`**

```ts
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueEvent } from "../automation/outbox";
import { isTerminal, nextStatus, type LoanAction, type LoanActor, type LoanStatus } from "../model/loanMachine";
import { audit } from "./audit";
import { appError } from "./errors";
import type { ActorType, CloseReason, EventType } from "./validators";

export type Notify = { type: EventType; recipientId: Id<"users"> };

// The only way a loan changes status: validate, patch, audit and enqueue
// notifications in the caller's transaction.
export async function applyLoanTransition(
  ctx: MutationCtx,
  input: {
    loan: Doc<"loans">;
    action: LoanAction;
    actor: LoanActor;
    actorId?: Id<"users">;
    actorType: ActorType;
    closeReason?: CloseReason;
    notify: Notify[];
  },
): Promise<LoanStatus> {
  const { loan } = input;
  const to = nextStatus(loan.status, input.action, input.actor);
  if (to === null) {
    throw appError("CONFLICT", `This request is ${loan.status} and can't be changed that way`);
  }

  const now = Date.now();
  const patch: Partial<Doc<"loans">> = { status: to };
  if (to === "approved") patch.approvedAt = now;
  if (to === "active") patch.handedOverAt = now;
  if (to === "returned") patch.returnedAt = now;
  if (isTerminal(to)) {
    patch.closedAt = now;
    if (input.closeReason) patch.closeReason = input.closeReason;
  }
  await ctx.db.patch(loan._id, patch);

  await audit(ctx, {
    actorId: input.actorId,
    actorType: input.actorType,
    action: `loan.${input.action}`,
    entityType: "loan",
    entityId: loan._id,
    fromStatus: loan.status,
    toStatus: to,
    reason: input.closeReason,
  });

  for (const n of input.notify) {
    await enqueueEvent(ctx, { type: n.type, recipientId: n.recipientId, loanId: loan._id, toolId: loan.toolId });
  }
  return to;
}
```

- [ ] **Step 5: Extend `convex/test.helpers.ts`**

Add the import `import rateLimiter from "@convex-dev/rate-limiter/test";` and `import type { Doc, Id } from "./_generated/dataModel";`, change `setupTest`, and append the seed helpers:

```ts
export function setupTest() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  return t;
}

export async function seedWorld(t: TestT) {
  const alice = await signIn(t, "alice"); // tool owner
  const bob = await signIn(t, "bob"); // borrower
  const carol = await signIn(t, "carol"); // unrelated neighbour
  const dana = await signIn(t, "dana"); // admin
  const toolId = await t.run((ctx) =>
    ctx.db.insert("tools", {
      ownerId: alice.id,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "18V with two batteries",
      status: "listed",
      updatedAt: Date.now(),
    }),
  );
  return { alice, bob, carol, dana, toolId };
}
export type World = Awaited<ReturnType<typeof seedWorld>>;

export async function insertLoan(
  t: TestT,
  world: World,
  fields: Partial<Omit<Doc<"loans">, "_id" | "_creationTime">> = {},
): Promise<Id<"loans">> {
  return await t.run((ctx) =>
    ctx.db.insert("loans", {
      toolId: world.toolId,
      ownerId: world.alice.id,
      borrowerId: world.bob.id,
      startDate: "2026-11-05",
      endDate: "2026-11-07",
      status: "pending",
      ...fields,
    }),
  );
}
```

- [ ] **Step 6: Write failing transition tests**

`convex/lib/loanTransitions.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "../test.helpers";
import { applyLoanTransition } from "./loanTransitions";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("approve patches, audits and enqueues in one go", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w);

  await t.run(async (ctx) => {
    const loan = (await ctx.db.get(loanId))!;
    const to = await applyLoanTransition(ctx, {
      loan,
      action: "approve",
      actor: "owner",
      actorId: w.alice.id,
      actorType: "user",
      notify: [{ type: "loan.approved", recipientId: w.bob.id }],
    });
    expect(to).toBe("approved");
  });

  const { loan, audits, events } = await t.run(async (ctx) => ({
    loan: await ctx.db.get(loanId),
    audits: await ctx.db.query("auditLog").collect(),
    events: await ctx.db.query("outboxEvents").collect(),
  }));
  expect(loan).toMatchObject({ status: "approved", approvedAt: NOW });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: "loan.approve",
    entityType: "loan",
    entityId: loanId,
    fromStatus: "pending",
    toStatus: "approved",
    actorId: w.alice.id,
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "loan.approved",
    recipientId: w.bob.id,
    loanId,
    toolId: w.toolId,
    status: "pending",
    attempts: 0,
    schemaVersion: 1,
  });
  // IDs only: no personal data on outbox rows
  expect(Object.keys(events[0]).sort()).toEqual(
    ["_creationTime", "_id", "attempts", "loanId", "recipientId", "schemaVersion", "status", "toolId", "type"].sort(),
  );
});

test("terminal transitions record closeReason and closedAt", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w);
  await t.run(async (ctx) => {
    const loan = (await ctx.db.get(loanId))!;
    await applyLoanTransition(ctx, {
      loan,
      action: "decline",
      actor: "system",
      actorType: "system",
      closeReason: "dates_taken",
      notify: [],
    });
  });
  const loan = await t.run((ctx) => ctx.db.get(loanId));
  expect(loan).toMatchObject({ status: "declined", closeReason: "dates_taken", closedAt: NOW });
});

test("rejected transition throws CONFLICT", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await insertLoan(t, w, { status: "returned" });
  await expectCode(
    t.run(async (ctx) => {
      const loan = (await ctx.db.get(loanId))!;
      await applyLoanTransition(ctx, { loan, action: "approve", actor: "owner", actorType: "user", notify: [] });
    }),
    "CONFLICT",
  );
});
```

- [ ] **Step 7: Run, then the whole suite**

Run: `pnpm vitest run convex/lib/loanTransitions.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add convex tests
git commit -m "feat(convex): add audit log, outbox enqueue, rate limits and loan transitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tools API

**Files:**
- Create: `convex/lib/tools.ts`, `convex/tools.ts`
- Test: `convex/tools.test.ts`

**Interfaces:**
- Consumes: wrappers (Task 5), `applyLoanTransition`, `audit`, `enqueueEvent`, `enforceLimit` (Task 6), `today` (Task 4), `displayName` (Task 5).
- Produces:
  - `lib/tools.ts`: `activeLoanFor(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans"> | null>`, `blockingLoans(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]>` (approved + active), `cleanToolFields(input: { name: string; description: string }): { name: string; description: string }` (throws `INVALID`), `removeToolCascade(ctx: MutationCtx, input: { tool: Doc<"tools">; actorId: Id<"users">; actorType: "user" | "admin"; reason?: string; notifyOwner: boolean }): Promise<{ cancelledLoans: number }>`, `type Availability = { state: "available" } | { state: "on_loan"; until: string }`, `availabilityOf(active: Doc<"loans"> | null): Availability`
  - `tools.ts`: `listPublic` (public, `{}` → `{ _id, name, category }[]`), `browse` (`{ category?, availableOnly?, search? }`), `get` (`{ toolId }`), `mine` (`{}`), `create` (`{ name, category, condition, description }` → `Id<"tools">`), `update` (`{ toolId, name, category, condition, description }` → `null`), `remove` (`{ toolId }` → `{ cancelledLoans }`)

- [ ] **Step 1: Implement `convex/lib/tools.ts`**

```ts
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { enqueueEvent } from "../automation/outbox";
import { audit } from "./audit";
import { appError } from "./errors";
import { applyLoanTransition } from "./loanTransitions";
import { LIMITS } from "./validators";

export type Availability = { state: "available" } | { state: "on_loan"; until: string };

export async function activeLoanFor(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans"> | null> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "active"))
    .first();
}

export async function blockingLoans(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  const active = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "active"))
    .collect();
  return [...approved, ...active];
}

export function availabilityOf(active: Doc<"loans"> | null): Availability {
  return active ? { state: "on_loan", until: active.endDate } : { state: "available" };
}

export function cleanToolFields(input: { name: string; description: string }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (name.length < LIMITS.toolNameMin || name.length > LIMITS.toolNameMax) {
    throw appError("INVALID", `Name must be ${LIMITS.toolNameMin} to ${LIMITS.toolNameMax} characters`);
  }
  if (description.length > LIMITS.descriptionMax) {
    throw appError("INVALID", `Description must be at most ${LIMITS.descriptionMax} characters`);
  }
  return { name, description };
}

// Cancels open requests for the tool, hides it, audits, and notifies.
export async function removeToolCascade(
  ctx: MutationCtx,
  input: {
    tool: Doc<"tools">;
    actorId: Id<"users">;
    actorType: "user" | "admin";
    reason?: string;
    notifyOwner: boolean;
  },
): Promise<{ cancelledLoans: number }> {
  const { tool } = input;
  const open = [
    ...(await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
      .collect()),
    ...(await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
      .collect()),
  ];
  for (const loan of open) {
    await applyLoanTransition(ctx, {
      loan,
      action: "closeForListingRemoval",
      actor: "system",
      actorId: input.actorId,
      actorType: input.actorType,
      closeReason: "listing_removed",
      notify: [{ type: "listing.removed", recipientId: loan.borrowerId }],
    });
  }

  const now = Date.now();
  await ctx.db.patch(tool._id, {
    status: "removed",
    removedAt: now,
    removedBy: input.actorId,
    removalReason: input.reason,
    updatedAt: now,
  });
  await audit(ctx, {
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.actorType === "admin" ? "tool.moderate" : "tool.remove",
    entityType: "tool",
    entityId: tool._id,
    fromStatus: "listed",
    toStatus: "removed",
    reason: input.reason,
  });
  if (input.notifyOwner) {
    await enqueueEvent(ctx, { type: "listing.removed", recipientId: tool.ownerId, toolId: tool._id });
  }
  return { cancelledLoans: open.length };
}
```

- [ ] **Step 2: Implement `convex/tools.ts`**

```ts
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { displayName } from "./lib/displayName";
import { appError } from "./lib/errors";
import { publicQuery, userMutation, userQuery } from "./lib/functions";
import { enforceLimit } from "./lib/rateLimits";
import { activeLoanFor, availabilityOf, blockingLoans, cleanToolFields, removeToolCascade } from "./lib/tools";
import { vCategory, vCondition } from "./lib/validators";

async function ownerSummary(ctx: QueryCtx, tool: Doc<"tools">) {
  const owner = await ctx.db.get(tool.ownerId);
  return {
    displayName: owner && owner.deletedAt === undefined ? displayName(owner.name) : "Former neighbour",
    isTrustedLender: owner?.isTrustedLender ?? false,
  };
}

// Public landing page: available tools, name and category only. No user data.
export const listPublic = publicQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_category", (q) => q.eq("status", "listed"))
      .take(200);
    const available: { _id: Doc<"tools">["_id"]; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const tool of tools) {
      if (!(await activeLoanFor(ctx, tool._id))) {
        available.push({ _id: tool._id, name: tool.name, category: tool.category });
      }
    }
    return available;
  },
});

export const browse = userQuery({
  args: {
    category: v.optional(vCategory),
    availableOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const category = args.category;
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_category", (q) =>
        category ? q.eq("status", "listed").eq("category", category) : q.eq("status", "listed"),
      )
      .take(300);
    const needle = args.search?.trim().toLowerCase();
    const rows = [];
    for (const tool of tools) {
      if (needle && !tool.name.toLowerCase().includes(needle)) continue;
      const active = await activeLoanFor(ctx, tool._id);
      if (args.availableOnly && active) continue;
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        isMine: tool.ownerId === ctx.user._id,
        owner: await ownerSummary(ctx, tool),
        availability: availabilityOf(active),
      });
    }
    return rows;
  },
});

export const get = userQuery({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await ctx.db.get(toolId);
    const isMine = tool?.ownerId === ctx.user._id;
    if (!tool || (tool.status === "removed" && !isMine && ctx.role !== "admin")) {
      throw appError("NOT_FOUND", "Tool not found");
    }
    const from = today();
    const booked = (await blockingLoans(ctx, toolId))
      .filter((loan) => loan.endDate >= from)
      .map((loan) => ({ startDate: loan.startDate, endDate: loan.endDate })) // dates only, no borrower identity
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      status: tool.status,
      removalReason: isMine ? tool.removalReason : undefined,
      isMine,
      owner: await ownerSummary(ctx, tool),
      availability: availabilityOf(await activeLoanFor(ctx, toolId)),
      bookedRanges: booked,
    };
  },
});

export const mine = userQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.user._id))
      .collect();
    const rows = [];
    for (const tool of tools) {
      const pending = await ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
        .collect();
      const active = await activeLoanFor(ctx, tool._id);
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        status: tool.status,
        removalReason: tool.removalReason,
        pendingRequests: pending.length,
        availability: availabilityOf(active),
        canDelete: tool.status === "listed" && !active,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

const toolFields = {
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
};

export const create = userMutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const clean = cleanToolFields(args);
    await enforceLimit(ctx, "toolCreate", ctx.user._id);
    const toolId = await ctx.db.insert("tools", {
      ownerId: ctx.user._id,
      name: clean.name,
      description: clean.description,
      category: args.category,
      condition: args.condition,
      status: "listed",
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "user",
      action: "tool.create",
      entityType: "tool",
      entityId: toolId,
      toStatus: "listed",
    });
    return toolId;
  },
});

async function loadOwnListedTool(ctx: QueryCtx & { user: Doc<"users"> }, toolId: Doc<"tools">["_id"]) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "Tool not found");
  if (tool.ownerId !== ctx.user._id) throw appError("FORBIDDEN", "Only the owner can change this listing");
  return tool;
}

export const update = userMutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    await loadOwnListedTool(ctx, toolId);
    const clean = cleanToolFields(args);
    await ctx.db.patch(toolId, {
      name: clean.name,
      description: clean.description,
      category: args.category,
      condition: args.condition,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "user",
      action: "tool.update",
      entityType: "tool",
      entityId: toolId,
    });
    return null;
  },
});

export const remove = userMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await loadOwnListedTool(ctx, toolId);
    if (await activeLoanFor(ctx, toolId)) {
      throw appError("CONFLICT", "This tool is on loan. Mark it returned before removing it.");
    }
    return await removeToolCascade(ctx, {
      tool,
      actorId: ctx.user._id,
      actorType: "user",
      notifyOwner: false,
    });
  },
});
```

- [ ] **Step 3: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 4: Write tools tests**

`convex/tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const drill = { name: "  Hedge   trimmer ", category: "garden", condition: "good", description: " Electric " } as const;

describe("listPublic", () => {
  test("anonymous callers get name and category only, without tools on loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const onLoan = await w.alice.as.mutation(api.tools.create, { ...drill, name: "Ladder" });
    await insertLoan(t, w, { toolId: onLoan, status: "active" });

    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toEqual([{ _id: w.toolId, name: "Cordless drill", category: "power_tools" }]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["_id", "category", "name"]);
  });
});

describe("create and update", () => {
  test("create trims fields and audits", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const id = await w.bob.as.mutation(api.tools.create, drill);
    const tool = await t.run((ctx) => ctx.db.get(id));
    expect(tool).toMatchObject({ name: "Hedge trimmer", description: "Electric", ownerId: w.bob.id, status: "listed" });
    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits.at(-1)).toMatchObject({ action: "tool.create", entityId: id, actorId: w.bob.id });
  });

  test("create rejects bad names", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.bob.as.mutation(api.tools.create, { ...drill, name: "ab" }), "INVALID");
    await expectCode(w.bob.as.mutation(api.tools.create, { ...drill, name: "x".repeat(61) }), "INVALID");
  });

  test("create is rate limited to 20 per day", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    for (let i = 0; i < 20; i++) {
      await w.carol.as.mutation(api.tools.create, { ...drill, name: `Tool ${i + 100}` });
    }
    await expectCode(w.carol.as.mutation(api.tools.create, { ...drill, name: "One too many" }), "RATE_LIMITED");
  });

  test("only the owner can update", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const edit = { toolId: w.toolId, ...drill, name: "Impact drill" };
    await expectCode(w.bob.as.mutation(api.tools.update, edit), "FORBIDDEN");
    await expectCode(w.dana.as.mutation(api.tools.update, edit), "FORBIDDEN");
    await w.alice.as.mutation(api.tools.update, edit);
    expect((await t.run((ctx) => ctx.db.get(w.toolId)))?.name).toBe("Impact drill");
  });
});

describe("remove", () => {
  test("blocked while a loan is active", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "active" });
    await expectCode(w.alice.as.mutation(api.tools.remove, { toolId: w.toolId }), "CONFLICT");
  });

  test("cancels open requests and notifies their borrowers", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const pending = await insertLoan(t, w, { status: "pending" });
    const approved = await insertLoan(t, w, {
      status: "approved",
      borrowerId: w.carol.id,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });
    const result = await w.alice.as.mutation(api.tools.remove, { toolId: w.toolId });
    expect(result).toEqual({ cancelledLoans: 2 });

    const state = await t.run(async (ctx) => ({
      tool: await ctx.db.get(w.toolId),
      pending: await ctx.db.get(pending),
      approved: await ctx.db.get(approved),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.tool?.status).toBe("removed");
    expect(state.pending).toMatchObject({ status: "cancelled", closeReason: "listing_removed" });
    expect(state.approved).toMatchObject({ status: "cancelled", closeReason: "listing_removed" });
    expect(state.events.map((e) => [e.type, e.recipientId]).sort()).toEqual(
      [
        ["listing.removed", w.bob.id],
        ["listing.removed", w.carol.id],
      ].sort(),
    );
    expect(await w.bob.as.query(api.tools.browse, {})).toEqual([]);
  });
});

describe("get and browse", () => {
  test("get shows booked ranges without borrower identity", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "approved" });
    await insertLoan(t, w, { status: "returned", startDate: "2026-10-01", endDate: "2026-10-02" });
    const tool = await w.carol.as.query(api.tools.get, { toolId: w.toolId });
    expect(tool.bookedRanges).toEqual([{ startDate: "2026-11-05", endDate: "2026-11-07" }]);
    expect(tool.owner).toEqual({ displayName: "Alice M.", isTrustedLender: false });
    expect(JSON.stringify(tool)).not.toContain("Bob");
  });

  test("removed tools are hidden from non-owners", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await w.alice.as.mutation(api.tools.remove, { toolId: w.toolId });
    await expectCode(w.carol.as.query(api.tools.get, { toolId: w.toolId }), "NOT_FOUND");
    expect((await w.alice.as.query(api.tools.get, { toolId: w.toolId })).status).toBe("removed");
  });

  test("browse filters by category, availability and search", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const trimmer = await w.bob.as.mutation(api.tools.create, drill);
    await insertLoan(t, w, { status: "active" }); // drill on loan

    expect((await w.carol.as.query(api.tools.browse, { category: "garden" })).map((r) => r._id)).toEqual([trimmer]);
    expect((await w.carol.as.query(api.tools.browse, { availableOnly: true })).map((r) => r._id)).toEqual([trimmer]);
    const found = await w.carol.as.query(api.tools.browse, { search: "DRILL" });
    expect(found).toHaveLength(1);
    expect(found[0].availability).toEqual({ state: "on_loan", until: "2026-11-07" });
  });
});
```

- [ ] **Step 5: Run**

Run: `pnpm vitest run convex/tools.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (the static `publicQuery` test now sees exactly `tools.ts:listPublic`).

- [ ] **Step 6: Commit**

```bash
git add convex
git commit -m "feat(tools): add listing API with public projection and cascade removal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Loans: request, approve (with auto-decline), decline

**Files:**
- Create: `convex/lib/loanAccess.ts`, `convex/loans.ts`
- Test: `convex/loans.request.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces:
  - `lib/loanAccess.ts`: `type Party = "owner" | "borrower"`, `loadLoanForParty(ctx: QueryCtx & ViewerCtx, loanId: Id<"loans">): Promise<{ loan: Doc<"loans">; party: Party }>` (non-party → `NOT_FOUND`), `requireParty(party: Party, required: Party): void` (→ `FORBIDDEN`)
  - `loans.ts`: `request({ toolId, startDate, endDate, message? }) → Id<"loans">`, `approve({ loanId }) → { autoDeclined: number }`, `decline({ loanId }) → null`

- [ ] **Step 1: Implement `convex/lib/loanAccess.ts`**

```ts
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import type { ViewerCtx } from "./functions";

export type Party = "owner" | "borrower";

export async function loadLoanForParty(
  ctx: QueryCtx & ViewerCtx,
  loanId: Id<"loans">,
): Promise<{ loan: Doc<"loans">; party: Party }> {
  const loan = await ctx.db.get(loanId);
  if (loan?.ownerId === ctx.user._id) return { loan, party: "owner" };
  if (loan?.borrowerId === ctx.user._id) return { loan, party: "borrower" };
  throw appError("NOT_FOUND", "Request not found");
}

export function requireParty(party: Party, required: Party): void {
  if (party !== required) {
    throw appError("FORBIDDEN", required === "owner" ? "Only the tool owner can do this" : "Only the borrower can do this");
  }
}
```

- [ ] **Step 2: Implement the first half of `convex/loans.ts`**

```ts
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { checkRequestedRange, type RangeProblem } from "./model/dates";
import { rangesOverlap } from "./model/overlap";
import { enqueueEvent } from "./automation/outbox";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { appError } from "./lib/errors";
import { userMutation } from "./lib/functions";
import { loadLoanForParty, requireParty } from "./lib/loanAccess";
import { applyLoanTransition } from "./lib/loanTransitions";
import { enforceLimit } from "./lib/rateLimits";
import { blockingLoans } from "./lib/tools";
import { LIMITS } from "./lib/validators";

const RANGE_MESSAGES: Record<RangeProblem, string> = {
  invalid_format: "Dates must look like 2026-11-05",
  end_before_start: "The end date must be on or after the start date",
  starts_in_past: "The start date can't be in the past",
  too_long: `Loans can be at most ${LIMITS.maxLoanDays} days`,
};

async function pendingOverlapping(ctx: MutationCtx, loan: Doc<"loans">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
    .collect();
  return pending.filter((other) => other._id !== loan._id && rangesOverlap(other, loan));
}

export const request = userMutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "Tool not found");
    if (tool.ownerId === ctx.user._id) throw appError("INVALID", "You can't borrow your own tool");

    const problem = checkRequestedRange(args.startDate, args.endDate, today(), LIMITS.maxLoanDays);
    if (problem) throw appError("INVALID", RANGE_MESSAGES[problem]);

    const message = args.message?.trim() || undefined;
    if (message && message.length > LIMITS.messageMax) {
      throw appError("INVALID", `Message must be at most ${LIMITS.messageMax} characters`);
    }

    await enforceLimit(ctx, "loanRequest", ctx.user._id);

    const range = { startDate: args.startDate, endDate: args.endDate };
    if ((await blockingLoans(ctx, tool._id)).some((loan) => rangesOverlap(loan, range))) {
      throw appError("CONFLICT", "Those dates are already booked");
    }
    const alreadyPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) => q.eq("borrowerId", ctx.user._id).eq("status", "pending"))
      .filter((q) => q.eq(q.field("toolId"), tool._id))
      .first();
    if (alreadyPending) throw appError("CONFLICT", "You already have a pending request for this tool");

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: ctx.user._id,
      startDate: args.startDate,
      endDate: args.endDate,
      message,
      status: "pending",
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "user",
      action: "loan.request",
      entityType: "loan",
      entityId: loanId,
      toStatus: "pending",
    });
    await enqueueEvent(ctx, { type: "loan.requested", recipientId: tool.ownerId, loanId, toolId: tool._id });
    return loanId;
  },
});

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    if (loan.status === "pending" && loan.startDate < today()) {
      throw appError("INVALID", "This request's start date has passed");
    }
    const clash = (await blockingLoans(ctx, loan.toolId)).some(
      (other) => other._id !== loan._id && rangesOverlap(other, loan),
    );
    if (clash) throw appError("CONFLICT", "Those dates are already booked");

    await applyLoanTransition(ctx, {
      loan,
      action: "approve",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.approved", recipientId: loan.borrowerId }],
    });

    const overlapping = await pendingOverlapping(ctx, loan);
    for (const other of overlapping) {
      await applyLoanTransition(ctx, {
        loan: other,
        action: "decline",
        actor: "system",
        actorType: "system",
        closeReason: "dates_taken",
        notify: [{ type: "loan.declined", recipientId: other.borrowerId }],
      });
    }
    return { autoDeclined: overlapping.length };
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    await applyLoanTransition(ctx, {
      loan,
      action: "decline",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      closeReason: "owner_declined",
      notify: [{ type: "loan.declined", recipientId: loan.borrowerId }],
    });
    return null;
  },
});
```

- [ ] **Step 3: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 4: Write tests**

`convex/loans.request.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // today = 2026-11-02 (UTC)
});
afterEach(() => vi.useRealTimers());

const dates = { startDate: "2026-11-05", endDate: "2026-11-07" };

describe("request", () => {
  test("creates a pending loan, audits, and notifies the owner", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates, message: " For a shelf " });
    const state = await t.run(async (ctx) => ({
      loan: await ctx.db.get(loanId),
      events: await ctx.db.query("outboxEvents").collect(),
      audits: await ctx.db.query("auditLog").collect(),
    }));
    expect(state.loan).toMatchObject({ status: "pending", ownerId: w.alice.id, borrowerId: w.bob.id, message: "For a shelf" });
    expect(state.events).toMatchObject([{ type: "loan.requested", recipientId: w.alice.id, loanId }]);
    expect(state.audits.at(-1)).toMatchObject({ action: "loan.request", toStatus: "pending" });
  });

  test("owners can't borrow their own tool", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.alice.as.mutation(api.loans.request, { toolId: w.toolId, ...dates }), "INVALID");
  });

  test.each([
    [{ startDate: "2026-11-01", endDate: "2026-11-03" }],
    [{ startDate: "2026-11-07", endDate: "2026-11-05" }],
    [{ startDate: "2026-11-05", endDate: "2026-12-30" }],
    [{ startDate: "11/05/2026", endDate: "2026-11-07" }],
  ])("rejects invalid range %o", async (range) => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...range }), "INVALID");
  });

  test("rejects dates that overlap an approved loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "approved", borrowerId: w.carol.id });
    await expectCode(
      w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-07", endDate: "2026-11-08" }),
      "CONFLICT",
    );
  });

  test("one pending request per borrower per tool", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await expectCode(
      w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-20", endDate: "2026-11-21" }),
      "CONFLICT",
    );
  });

  test("rate limited to 10 per hour", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    for (let i = 0; i < 10; i++) {
      const toolId = await w.alice.as.mutation(api.tools.create, {
        name: `Clamp ${i + 10}`,
        category: "hand_tools",
        condition: "good",
        description: "",
      });
      await w.bob.as.mutation(api.loans.request, { toolId, ...dates });
    }
    const last = await w.alice.as.mutation(api.tools.create, {
      name: "Clamp 99",
      category: "hand_tools",
      condition: "good",
      description: "",
    });
    await expectCode(w.bob.as.mutation(api.loans.request, { toolId: last, ...dates }), "RATE_LIMITED");
  });
});

describe("approve and decline", () => {
  test("approve auto-declines overlapping pending requests", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const bobs = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    const carols = await w.carol.as.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-06",
      endDate: "2026-11-08",
    });
    const danas = await w.dana.as.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });

    expect(await w.alice.as.mutation(api.loans.approve, { loanId: bobs })).toEqual({ autoDeclined: 1 });

    const state = await t.run(async (ctx) => ({
      bob: await ctx.db.get(bobs),
      carol: await ctx.db.get(carols),
      dana: await ctx.db.get(danas),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.bob?.status).toBe("approved");
    expect(state.carol).toMatchObject({ status: "declined", closeReason: "dates_taken" });
    expect(state.dana?.status).toBe("pending");
    expect(state.events.filter((e) => e.type !== "loan.requested").map((e) => [e.type, e.recipientId])).toEqual([
      ["loan.approved", w.bob.id],
      ["loan.declined", w.carol.id],
    ]);
  });

  test("only the owner may approve; strangers can't see the request", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await expectCode(w.bob.as.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
    await expectCode(w.carol.as.mutation(api.loans.approve, { loanId }), "NOT_FOUND");
    await expectCode(w.dana.as.mutation(api.loans.approve, { loanId }), "NOT_FOUND");
  });

  test("cannot approve after the start date has passed", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { startDate: "2026-11-01", endDate: "2026-11-03" });
    await expectCode(w.alice.as.mutation(api.loans.approve, { loanId }), "INVALID");
  });

  test("decline closes with owner_declined and notifies the borrower", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, ...dates });
    await w.alice.as.mutation(api.loans.decline, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({ status: "declined", closeReason: "owner_declined" });
    await expectCode(w.alice.as.mutation(api.loans.decline, { loanId }), "CONFLICT");
  });
});
```

- [ ] **Step 5: Run**

Run: `pnpm vitest run convex/loans.request.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex
git commit -m "feat(loans): add borrow requests, approval with auto-decline, and decline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Loans: cancel, hand over, return, and read models (my requests, incoming, timeline)

**Files:**
- Modify: `convex/loans.ts`, `convex/lib/loanAccess.ts`
- Test: `convex/loans.lifecycle.test.ts`, `convex/loans.queries.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces:
  - `lib/loanAccess.ts` addition: `summarizeLoan(ctx: QueryCtx, loan: Doc<"loans">, today: string, viewer: Party | "admin"): Promise<LoanSummary>` where `LoanSummary = { _id; status; startDate; endDate; closeReason?; overdue: boolean; daysOverdue: number; tool: { _id; name; category }; owner: { displayName }; borrower: { displayName }; message?: string }` (`message` only for viewer `"owner"`)
  - `loans.ts` additions: `cancel({ loanId }) → null`, `handOver({ loanId }) → null`, `markReturned({ loanId }) → null`, `myRequests({}) → LoanSummary[]`, `incoming({}) → (LoanSummary & { conflicts: number })[]`, `timeline({ loanId }) → { loan: LoanSummary; nextStep: NextStep; entries: TimelineEntry[] }` with `TimelineEntry = { kind: "status"; at; action; toStatus?; reason?; actor: string } | { kind: "notification"; at; type; status; recipient: "owner" | "borrower"; error?: string } | { kind: "reminder"; at; status: "sent" | "failed" }`

- [ ] **Step 1: Add `summarizeLoan` to `convex/lib/loanAccess.ts`**

Append (and add imports `import { daysOverdue, isOverdue } from "../model/dates";` and `import { displayName } from "./displayName";`):

```ts
async function nameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const user = await ctx.db.get(userId);
  return user && user.deletedAt === undefined ? displayName(user.name) : "Former neighbour";
}

export async function summarizeLoan(
  ctx: QueryCtx,
  loan: Doc<"loans">,
  today: string,
  viewer: Party | "admin",
) {
  const tool = await ctx.db.get(loan.toolId);
  const overdue = isOverdue(loan, today);
  return {
    _id: loan._id,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    closeReason: loan.closeReason,
    overdue,
    daysOverdue: overdue ? daysOverdue(loan.endDate, today) : 0,
    tool: { _id: loan.toolId, name: tool?.name ?? "Removed tool", category: tool?.category ?? "other" },
    owner: { displayName: await nameOf(ctx, loan.ownerId) },
    borrower: { displayName: await nameOf(ctx, loan.borrowerId) },
    message: viewer === "owner" ? loan.message : undefined,
  };
}
export type LoanSummary = Awaited<ReturnType<typeof summarizeLoan>>;
export { nameOf };
```

- [ ] **Step 2: Append mutations and queries to `convex/loans.ts`**

Add imports: `import type { Id } from "./_generated/dataModel";`, `import { nextStep } from "./model/loanMachine";`, `import { userQuery } from "./lib/functions";` (merge with the existing `userMutation` import), `import { nameOf, summarizeLoan } from "./lib/loanAccess";` (merge), `import { activeLoanFor } from "./lib/tools";` (merge). Then append:

```ts
export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    const counterpart = party === "owner" ? loan.borrowerId : loan.ownerId;
    await applyLoanTransition(ctx, {
      loan,
      action: "cancel",
      actor: party,
      actorId: ctx.user._id,
      actorType: "user",
      closeReason: party === "owner" ? "owner_cancelled" : "borrower_cancelled",
      notify: [{ type: "loan.cancelled", recipientId: counterpart }],
    });
    return null;
  },
});

export const handOver = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    if (loan.status === "approved" && today() > loan.endDate) {
      throw appError("INVALID", "This booking has already ended");
    }
    const active = await activeLoanFor(ctx, loan.toolId);
    if (active && active._id !== loan._id) {
      throw appError("CONFLICT", "This tool is still out on another loan");
    }
    await applyLoanTransition(ctx, {
      loan,
      action: "handOver",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.handed_over", recipientId: loan.borrowerId }],
    });
    return null;
  },
});

export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner"); // the owner confirms they got it back
    await applyLoanTransition(ctx, {
      loan,
      action: "markReturned",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.returned", recipientId: loan.borrowerId }],
    });
    return null;
  },
});

export const myRequests = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) => q.eq("borrowerId", ctx.user._id))
      .take(200);
    const t0 = today();
    const sorted = loans.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(sorted.map((loan) => summarizeLoan(ctx, loan, t0, "borrower")));
  },
});

export const incoming = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ctx.user._id))
      .take(200);
    const t0 = today();
    const sorted = loans.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      sorted.map(async (loan) => {
        const conflicts =
          loan.status === "pending"
            ? loans.filter(
                (other) =>
                  other._id !== loan._id &&
                  other.toolId === loan.toolId &&
                  (other.status === "pending" || other.status === "approved") &&
                  rangesOverlap(other, loan),
              ).length
            : 0;
        return { ...(await summarizeLoan(ctx, loan, t0, "owner")), conflicts };
      }),
    );
  },
});

export const timeline = userQuery({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get(loanId);
    const party = loan?.ownerId === ctx.user._id ? "owner" : loan?.borrowerId === ctx.user._id ? "borrower" : null;
    const isAdmin = ctx.role === "admin";
    if (!loan || (!party && !isAdmin)) throw appError("NOT_FOUND", "Request not found");

    const audits = await ctx.db
      .query("auditLog")
      .withIndex("by_entity", (q) => q.eq("entityType", "loan").eq("entityId", loanId))
      .collect();
    const events = await ctx.db
      .query("outboxEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect();
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect();

    const names = new Map<Id<"users">, string>();
    const actorName = async (id: Id<"users"> | undefined) => {
      if (!id) return "LendLoop";
      if (!names.has(id)) names.set(id, await nameOf(ctx, id));
      return names.get(id)!;
    };

    const statusEntries = await Promise.all(
      audits.map(async (a) => ({
        kind: "status" as const,
        at: a.at,
        action: a.action,
        toStatus: a.toStatus,
        reason: a.reason,
        actor: a.actorType === "system" ? "LendLoop" : await actorName(a.actorId),
      })),
    );
    const notificationEntries = events.map((e) => ({
      kind: "notification" as const,
      at: e.sentAt ?? e.deliveredAt ?? e._creationTime,
      type: e.type,
      status: e.status,
      recipient: e.recipientId === loan.ownerId ? ("owner" as const) : ("borrower" as const),
      error: isAdmin ? e.lastError : undefined,
    }));
    const reminderEntries = reminders.map((r) => ({
      kind: "reminder" as const,
      at: r._creationTime,
      status: r.status,
    }));

    return {
      loan: await summarizeLoan(ctx, loan, today(), party ?? "admin"),
      nextStep: nextStep(loan.status),
      entries: [...statusEntries, ...notificationEntries, ...reminderEntries].sort((a, b) => a.at - b.at),
    };
  },
});
```

- [ ] **Step 3: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 4: Write lifecycle tests**

`convex/loans.lifecycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("cancel", () => {
  test("borrower cancels pending; owner is notified", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w);
    await w.bob.as.mutation(api.loans.cancel, { loanId });
    const state = await t.run(async (ctx) => ({
      loan: await ctx.db.get(loanId),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.loan).toMatchObject({ status: "cancelled", closeReason: "borrower_cancelled" });
    expect(state.events).toMatchObject([{ type: "loan.cancelled", recipientId: w.alice.id }]);
  });

  test("owner cancels approved; owner cannot cancel pending", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const pending = await insertLoan(t, w);
    await expectCode(w.alice.as.mutation(api.loans.cancel, { loanId: pending }), "CONFLICT");
    const approved = await insertLoan(t, w, { status: "approved", startDate: "2026-11-20", endDate: "2026-11-21" });
    await w.alice.as.mutation(api.loans.cancel, { loanId: approved });
    expect((await t.run((ctx) => ctx.db.get(approved)))?.closeReason).toBe("owner_cancelled");
  });

  test("nobody can cancel an active loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active" });
    await expectCode(w.bob.as.mutation(api.loans.cancel, { loanId }), "CONFLICT");
  });
});

describe("handOver and markReturned", () => {
  test("happy path approved → active → returned", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "approved" });
    await w.alice.as.mutation(api.loans.handOver, { loanId });
    await w.alice.as.mutation(api.loans.markReturned, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({ status: "returned", handedOverAt: NOW, returnedAt: NOW, closedAt: NOW });
  });

  test("borrower can't self-declare a return", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "active" });
    await expectCode(w.bob.as.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
  });

  test("hand over is blocked while another loan is active", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-10-30", endDate: "2026-11-03" });
    const loanId = await insertLoan(t, w, { status: "approved" });
    await expectCode(w.alice.as.mutation(api.loans.handOver, { loanId }), "CONFLICT");
  });

  test("hand over is blocked after the booking ended", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const loanId = await insertLoan(t, w, { status: "approved", startDate: "2026-10-28", endDate: "2026-11-01" });
    await expectCode(w.alice.as.mutation(api.loans.handOver, { loanId }), "INVALID");
  });
});
```

- [ ] **Step 5: Write query tests**

`convex/loans.queries.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // 2026-11-02
});
afterEach(() => vi.useRealTimers());

test("myRequests shows display names and overdue state, never the message to the borrower", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await insertLoan(t, w, { status: "active", startDate: "2026-10-25", endDate: "2026-10-30", message: "secret" });
  const [row] = await w.bob.as.query(api.loans.myRequests, {});
  expect(row).toMatchObject({
    status: "active",
    overdue: true,
    daysOverdue: 3,
    owner: { displayName: "Alice M." },
    tool: { name: "Cordless drill" },
  });
  expect(row.message).toBeUndefined();
});

test("incoming shows the message to the owner and counts conflicts", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await w.bob.as.mutation(api.loans.request, {
    toolId: w.toolId,
    startDate: "2026-11-05",
    endDate: "2026-11-07",
    message: "For a shelf",
  });
  await w.carol.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-06", endDate: "2026-11-09" });
  const rows = await w.alice.as.query(api.loans.incoming, {});
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.conflicts === 1)).toBe(true);
  expect(rows.find((r) => r.borrower.displayName === "Bob K.")?.message).toBe("For a shelf");
});

test("timeline merges status changes and notifications, visible to parties and admins only", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const loanId = await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-05", endDate: "2026-11-07" });
  vi.setSystemTime(NOW + 60_000);
  await w.alice.as.mutation(api.loans.approve, { loanId });

  const view = await w.bob.as.query(api.loans.timeline, { loanId });
  expect(view.nextStep).toBe("handover");
  expect(view.entries.map((e) => e.kind)).toEqual(["status", "notification", "status", "notification"]);
  expect(view.entries[2]).toMatchObject({ kind: "status", action: "loan.approve", actor: "Alice M." });
  expect(view.entries[1]).toMatchObject({ kind: "notification", type: "loan.requested", recipient: "owner" });

  await w.dana.as.query(api.loans.timeline, { loanId });
  await expectCode(w.carol.as.query(api.loans.timeline, { loanId }), "NOT_FOUND");
});
```

- [ ] **Step 6: Run**

Run: `pnpm vitest run convex/loans.lifecycle.test.ts convex/loans.queries.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add convex
git commit -m "feat(loans): add cancel, handover, return and loan read models with timeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Expiry cron

**Files:**
- Modify: `convex/loans.ts`
- Create: `convex/crons.ts`
- Test: `convex/loans.expiry.test.ts`

**Interfaces:**
- Produces: `internal.loans.expireStale` (internalMutation, `{}` → `{ expired: number }`); cron `"expire stale loans"` hourly at minute 5.

- [ ] **Step 1: Write the failing test**

`convex/loans.expiry.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { NOW, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // 2026-11-02
});
afterEach(() => vi.useRealTimers());

test("expires stale pending and never-handed-over approved loans only", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const stalePending = await insertLoan(t, w, { startDate: "2026-11-01", endDate: "2026-11-03" });
  const todayPending = await insertLoan(t, w, { startDate: "2026-11-02", endDate: "2026-11-03", borrowerId: w.carol.id });
  const staleApproved = await insertLoan(t, w, { status: "approved", startDate: "2026-10-28", endDate: "2026-11-01" });
  const liveApproved = await insertLoan(t, w, { status: "approved", startDate: "2026-10-30", endDate: "2026-11-02" });
  const overdueActive = await insertLoan(t, w, { status: "active", startDate: "2026-10-20", endDate: "2026-10-25" });

  expect(await t.mutation(internal.loans.expireStale, {})).toEqual({ expired: 2 });

  const state = await t.run(async (ctx) => ({
    stalePending: await ctx.db.get(stalePending),
    todayPending: await ctx.db.get(todayPending),
    staleApproved: await ctx.db.get(staleApproved),
    liveApproved: await ctx.db.get(liveApproved),
    overdueActive: await ctx.db.get(overdueActive),
    events: await ctx.db.query("outboxEvents").collect(),
  }));
  expect(state.stalePending).toMatchObject({ status: "expired", closeReason: "start_passed" });
  expect(state.todayPending?.status).toBe("pending");
  expect(state.staleApproved).toMatchObject({ status: "expired", closeReason: "not_handed_over" });
  expect(state.liveApproved?.status).toBe("approved");
  expect(state.overdueActive?.status).toBe("active"); // overdue is derived, never expired
  expect(state.events.map((e) => [e.type, e.recipientId])).toEqual([
    ["loan.expired", w.bob.id],
    ["loan.expired", w.bob.id],
    ["loan.expired", w.alice.id],
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run convex/loans.expiry.test.ts`
Expected: FAIL, `internal.loans.expireStale` is not a function.

- [ ] **Step 3: Implement**

Append to `convex/loans.ts` (merge `internalMutation` into the `./lib/functions` import):

```ts
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const t0 = today();
    const stalePending = await ctx.db
      .query("loans")
      .withIndex("by_status_startDate", (q) => q.eq("status", "pending").lt("startDate", t0))
      .take(200);
    for (const loan of stalePending) {
      await applyLoanTransition(ctx, {
        loan,
        action: "expire",
        actor: "system",
        actorType: "system",
        closeReason: "start_passed",
        notify: [{ type: "loan.expired", recipientId: loan.borrowerId }],
      });
    }
    const staleApproved = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", t0))
      .take(200);
    for (const loan of staleApproved) {
      await applyLoanTransition(ctx, {
        loan,
        action: "expire",
        actor: "system",
        actorType: "system",
        closeReason: "not_handed_over",
        notify: [
          { type: "loan.expired", recipientId: loan.borrowerId },
          { type: "loan.expired", recipientId: loan.ownerId },
        ],
      });
    }
    return { expired: stalePending.length + staleApproved.length };
  },
});
```

`convex/crons.ts`:

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("expire stale loans", { minuteUTC: 5 }, internal.loans.expireStale, {});

export default crons;
```

- [ ] **Step 4: Push and run**

Run: `pnpm convex:push && pnpm vitest run convex/loans.expiry.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex
git commit -m "feat(loans): expire stale pending and never-handed-over loans hourly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Admin API

**Files:**
- Create: `convex/admin.ts`
- Test: `convex/admin.test.ts`

**Interfaces:**
- Consumes: `adminQuery`, `adminMutation`, `summarizeLoan`, `removeToolCascade`, `maskEmail`, `displayName`, `audit`.
- Produces: `admin.listLoans({ status?, overdueOnly? }) → LoanSummary[]`, `admin.listTools({}) → { _id, name, category, status, removalReason?, owner: { displayName, isTrustedLender } }[]`, `admin.listUsers({}) → { _id, displayName, maskedEmail, isTrustedLender, listings, joinedAt }[]`, `admin.removeTool({ toolId, reason }) → { cancelledLoans }`, `admin.setTrustedLender({ userId, trusted }) → null`, `admin.auditLog({ entityType?, entityId?, limit? }) → { _id, at, action, actorType, actor, entityType, entityId, fromStatus?, toStatus?, reason? }[]`. (`automationHealth`, `replayEvent`, `resolveError` are added in Plan 2.)

- [ ] **Step 1: Implement `convex/admin.ts`**

```ts
import { v } from "convex/values";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { displayName, maskEmail } from "./lib/displayName";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { nameOf, summarizeLoan } from "./lib/loanAccess";
import { removeToolCascade } from "./lib/tools";
import { LIMITS, vEntityType, vLoanStatus } from "./lib/validators";

export const listLoans = adminQuery({
  args: { status: v.optional(vLoanStatus), overdueOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const t0 = today();
    const status = args.overdueOnly ? "active" : args.status;
    const loans = status
      ? await ctx.db
          .query("loans")
          .withIndex("by_status_endDate", (q) => q.eq("status", status))
          .order("desc")
          .take(500)
      : await ctx.db.query("loans").order("desc").take(500);
    const rows = await Promise.all(loans.map((loan) => summarizeLoan(ctx, loan, t0, "admin")));
    return args.overdueOnly ? rows.filter((row) => row.overdue) : rows;
  },
});

export const listTools = adminQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(500);
    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          status: tool.status,
          removalReason: tool.removalReason,
          owner: {
            displayName: owner && owner.deletedAt === undefined ? displayName(owner.name) : "Former neighbour",
            isTrustedLender: owner?.isTrustedLender ?? false,
          },
        };
      }),
    );
  },
});

export const listUsers = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = (await ctx.db.query("users").order("desc").take(500)).filter((u) => u.deletedAt === undefined);
    return await Promise.all(
      users.map(async (user) => {
        const listings = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();
        return {
          _id: user._id,
          displayName: displayName(user.name),
          maskedEmail: maskEmail(user.email),
          isTrustedLender: user.isTrustedLender,
          listings: listings.filter((t) => t.status === "listed").length,
          joinedAt: user._creationTime,
        };
      }),
    );
  },
});

export const removeTool = adminMutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, { toolId, reason }) => {
    const clean = reason.trim();
    if (clean.length < LIMITS.removalReasonMin || clean.length > LIMITS.removalReasonMax) {
      throw appError("INVALID", `Reason must be ${LIMITS.removalReasonMin} to ${LIMITS.removalReasonMax} characters`);
    }
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "Tool not found");
    // An active loan continues until returned; only open requests are cancelled.
    return await removeToolCascade(ctx, {
      tool,
      actorId: ctx.user._id,
      actorType: "admin",
      reason: clean,
      notifyOwner: true,
    });
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt !== undefined) throw appError("NOT_FOUND", "User not found");
    if (user.isTrustedLender === trusted) return null;
    await ctx.db.patch(userId, trusted
      ? { isTrustedLender: true, trustedAt: Date.now(), trustedBy: ctx.user._id }
      : { isTrustedLender: false, trustedAt: undefined, trustedBy: undefined });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "admin",
      action: trusted ? "user.trust" : "user.untrust",
      entityType: "user",
      entityId: userId,
    });
    return null;
  },
});

export const auditLog = adminQuery({
  args: { entityType: v.optional(vEntityType), entityId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const entityType = args.entityType;
    const entityId = args.entityId;
    const rows =
      entityType && entityId
        ? await ctx.db
            .query("auditLog")
            .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
            .order("desc")
            .take(limit)
        : await ctx.db.query("auditLog").withIndex("by_time").order("desc").take(limit);
    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        at: row.at,
        action: row.action,
        actorType: row.actorType,
        actor: row.actorId ? await nameOf(ctx, row.actorId) : "LendLoop",
        entityType: row.entityType,
        entityId: row.entityId,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
      })),
    );
  },
});
```

- [ ] **Step 2: Push**

Run: `pnpm convex:push` → success.

- [ ] **Step 3: Write tests**

`convex/admin.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test("regular users are forbidden", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await expectCode(w.alice.as.query(api.admin.listLoans, {}), "FORBIDDEN");
  await expectCode(w.alice.as.mutation(api.admin.setTrustedLender, { userId: w.alice.id, trusted: true }), "FORBIDDEN");
});

test("listUsers masks emails", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const users = await w.dana.as.query(api.admin.listUsers, {});
  const alice = users.find((u) => u._id === w.alice.id);
  expect(alice).toMatchObject({ displayName: "Alice M.", maskedEmail: "a***@example.com", listings: 1 });
  expect(JSON.stringify(users)).not.toContain("alice@example.com");
});

test("removeTool keeps the active loan, cancels open requests, notifies owner and borrowers", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  const active = await insertLoan(t, w, { status: "active", startDate: "2026-10-30", endDate: "2026-11-03" });
  const pending = await insertLoan(t, w, { borrowerId: w.carol.id, startDate: "2026-11-10", endDate: "2026-11-11" });

  await expectCode(w.dana.as.mutation(api.admin.removeTool, { toolId: w.toolId, reason: "x" }), "INVALID");
  expect(await w.dana.as.mutation(api.admin.removeTool, { toolId: w.toolId, reason: "Unsafe item" })).toEqual({
    cancelledLoans: 1,
  });

  const state = await t.run(async (ctx) => ({
    tool: await ctx.db.get(w.toolId),
    active: await ctx.db.get(active),
    pending: await ctx.db.get(pending),
    events: await ctx.db.query("outboxEvents").collect(),
    audits: await ctx.db.query("auditLog").collect(),
  }));
  expect(state.tool).toMatchObject({ status: "removed", removalReason: "Unsafe item", removedBy: w.dana.id });
  expect(state.active?.status).toBe("active");
  expect(state.pending?.status).toBe("cancelled");
  expect(state.events.map((e) => [e.type, e.recipientId])).toEqual([
    ["listing.removed", w.carol.id],
    ["listing.removed", w.alice.id],
  ]);
  expect(state.audits.at(-1)).toMatchObject({ action: "tool.moderate", actorType: "admin", reason: "Unsafe item" });
});

test("setTrustedLender toggles and audits", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await w.dana.as.mutation(api.admin.setTrustedLender, { userId: w.alice.id, trusted: true });
  expect((await w.carol.as.query(api.tools.get, { toolId: w.toolId })).owner.isTrustedLender).toBe(true);
  const log = await w.dana.as.query(api.admin.auditLog, { entityType: "user", entityId: w.alice.id });
  expect(log).toMatchObject([{ action: "user.trust", actor: "Dana O." }]);
});

test("listLoans overdueOnly", async () => {
  const t = setupTest();
  const w = await seedWorld(t);
  await insertLoan(t, w, { status: "active", startDate: "2026-10-20", endDate: "2026-10-25" });
  await insertLoan(t, w, { status: "active", borrowerId: w.carol.id, startDate: "2026-11-01", endDate: "2026-11-04" });
  const rows = await w.dana.as.query(api.admin.listLoans, { overdueOnly: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ overdue: true, borrower: { displayName: "Bob K." } });
});
```

- [ ] **Step 4: Run**

Run: `pnpm vitest run convex/admin.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex
git commit -m "feat(admin): add moderation, trusted lender, loan and audit views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Authorization matrix (tested, coverage-checked, generated doc)

**Files:**
- Create: `tests/authz/matrix.ts`, `convex/authz.test.ts`, `tests/static/authzCoverage.test.ts`, `scripts/authz-matrix.ts`, `docs/authz-matrix.md` (generated)

**Interfaces:**
- Produces: `tests/authz/matrix.ts` exports `ACTORS`, `type Actor`, `type Outcome = "allow" | ErrorCode`, `MATRIX: { fn: string; description: string; expect: Record<Actor, Outcome> }[]`, `renderMatrix(): string`. `pnpm docs:authz` writes `docs/authz-matrix.md`; `pnpm docs:authz --check` exits 1 when the file is stale (used by CI in Plan 4).

- [ ] **Step 1: Write the matrix data**

`tests/authz/matrix.ts`:

```ts
// Source of truth for who may call what. convex/authz.test.ts proves every
// cell against the real functions; scripts/authz-matrix.ts renders the doc.
import type { ErrorCode } from "../../convex/lib/errors";

export const ACTORS = ["anonymous", "owner", "borrower", "otherUser", "admin"] as const;
export type Actor = (typeof ACTORS)[number];
export type Outcome = "allow" | ErrorCode;
export interface MatrixRow {
  fn: string;
  description: string;
  expect: Record<Actor, Outcome>;
}

const everyone: Record<Actor, Outcome> = {
  anonymous: "allow",
  owner: "allow",
  borrower: "allow",
  otherUser: "allow",
  admin: "allow",
};
const signedIn: Record<Actor, Outcome> = { ...everyone, anonymous: "UNAUTHENTICATED" };
const toolOwnerOnly: Record<Actor, Outcome> = {
  anonymous: "UNAUTHENTICATED",
  owner: "allow",
  borrower: "FORBIDDEN",
  otherUser: "FORBIDDEN",
  admin: "FORBIDDEN",
};
const loanOwnerOnly: Record<Actor, Outcome> = {
  anonymous: "UNAUTHENTICATED",
  owner: "allow",
  borrower: "FORBIDDEN",
  otherUser: "NOT_FOUND",
  admin: "NOT_FOUND",
};
const adminOnly: Record<Actor, Outcome> = {
  anonymous: "UNAUTHENTICATED",
  owner: "FORBIDDEN",
  borrower: "FORBIDDEN",
  otherUser: "FORBIDDEN",
  admin: "allow",
};

export const MATRIX: MatrixRow[] = [
  { fn: "tools:listPublic", description: "Available tools, name and category only", expect: everyone },
  { fn: "tools:browse", description: "Browse listed tools with availability", expect: signedIn },
  { fn: "tools:get", description: "Tool details and booked date ranges", expect: signedIn },
  { fn: "tools:mine", description: "My listings", expect: signedIn },
  { fn: "tools:create", description: "List a tool", expect: signedIn },
  { fn: "tools:update", description: "Edit a listing", expect: toolOwnerOnly },
  { fn: "tools:remove", description: "Delete a listing", expect: toolOwnerOnly },
  {
    fn: "loans:request",
    description: "Request to borrow a tool",
    expect: { ...signedIn, owner: "INVALID" },
  },
  { fn: "loans:approve", description: "Approve a request", expect: loanOwnerOnly },
  { fn: "loans:decline", description: "Decline a request", expect: loanOwnerOnly },
  {
    fn: "loans:cancel",
    description: "Cancel an approved booking (either party)",
    expect: { ...loanOwnerOnly, borrower: "allow" },
  },
  { fn: "loans:handOver", description: "Mark a tool as handed over", expect: loanOwnerOnly },
  { fn: "loans:markReturned", description: "Confirm a tool came back", expect: loanOwnerOnly },
  { fn: "loans:myRequests", description: "My borrowing", expect: signedIn },
  { fn: "loans:incoming", description: "Requests on my tools", expect: signedIn },
  {
    fn: "loans:timeline",
    description: "Loan activity",
    expect: { ...loanOwnerOnly, borrower: "allow", admin: "allow" },
  },
  { fn: "users:syncMe", description: "Create or refresh my profile from my token", expect: signedIn },
  { fn: "users:me", description: "My profile and role", expect: signedIn },
  { fn: "admin:listLoans", description: "All loans", expect: adminOnly },
  { fn: "admin:listTools", description: "All listings", expect: adminOnly },
  { fn: "admin:listUsers", description: "Users with masked emails", expect: adminOnly },
  { fn: "admin:removeTool", description: "Remove any listing", expect: adminOnly },
  { fn: "admin:setTrustedLender", description: "Mark a Trusted Lender", expect: adminOnly },
  { fn: "admin:auditLog", description: "Audit trail", expect: adminOnly },
];

export function renderMatrix(): string {
  const header = `| Function | What it does | ${ACTORS.join(" | ")} |`;
  const divider = `|---|---|${ACTORS.map(() => "---").join("|")}|`;
  const rows = MATRIX.map(
    (row) =>
      `| \`${row.fn}\` | ${row.description} | ${ACTORS.map((a) => (row.expect[a] === "allow" ? "✅" : `❌ ${row.expect[a]}`)).join(" | ")} |`,
  );
  return [
    "# Authorization matrix",
    "",
    "Generated by `pnpm docs:authz` from `tests/authz/matrix.ts`. Every cell is asserted against the real Convex functions in `convex/authz.test.ts`, and `tests/static/authzCoverage.test.ts` fails if a public function is missing from the matrix.",
    "",
    "Actors: **owner** owns the tool (or is the lender on the loan), **borrower** made the request, **otherUser** is an unrelated signed-in neighbour, **admin** has `role: admin` in their Clerk token.",
    "",
    "`NOT_FOUND` is returned instead of `FORBIDDEN` when the caller should not learn that the resource exists.",
    "",
    header,
    divider,
    ...rows,
    "",
  ].join("\n");
}
```

- [ ] **Step 2: Write the executable matrix test**

`convex/authz.test.ts`:

```ts
import type { FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACTORS, MATRIX, type Actor } from "../tests/authz/matrix";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOW, expectCode, insertLoan, seedWorld, setupTest, type World } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

type Needs = "none" | "pending" | "approved" | "active";
type Ctx = World & { loanId: Id<"loans"> };
type Call = {
  kind: "query" | "mutation";
  ref: FunctionReference<"query" | "mutation", "public">;
  needs: Needs;
  args: (c: Ctx) => Record<string, unknown>;
};

const toolEdit = (c: Ctx) => ({
  toolId: c.toolId,
  name: "Impact drill",
  category: "power_tools",
  condition: "good",
  description: "",
});

const CALLS: Record<string, Call> = {
  "tools:listPublic": { kind: "query", ref: api.tools.listPublic, needs: "none", args: () => ({}) },
  "tools:browse": { kind: "query", ref: api.tools.browse, needs: "none", args: () => ({}) },
  "tools:get": { kind: "query", ref: api.tools.get, needs: "none", args: (c) => ({ toolId: c.toolId }) },
  "tools:mine": { kind: "query", ref: api.tools.mine, needs: "none", args: () => ({}) },
  "tools:create": {
    kind: "mutation",
    ref: api.tools.create,
    needs: "none",
    args: () => ({ name: "Stand mixer", category: "kitchen", condition: "good", description: "" }),
  },
  "tools:update": { kind: "mutation", ref: api.tools.update, needs: "none", args: toolEdit },
  "tools:remove": { kind: "mutation", ref: api.tools.remove, needs: "none", args: (c) => ({ toolId: c.toolId }) },
  "loans:request": {
    kind: "mutation",
    ref: api.loans.request,
    needs: "none",
    args: (c) => ({ toolId: c.toolId, startDate: "2026-11-05", endDate: "2026-11-07" }),
  },
  "loans:approve": { kind: "mutation", ref: api.loans.approve, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "loans:decline": { kind: "mutation", ref: api.loans.decline, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "loans:cancel": { kind: "mutation", ref: api.loans.cancel, needs: "approved", args: (c) => ({ loanId: c.loanId }) },
  "loans:handOver": { kind: "mutation", ref: api.loans.handOver, needs: "approved", args: (c) => ({ loanId: c.loanId }) },
  "loans:markReturned": {
    kind: "mutation",
    ref: api.loans.markReturned,
    needs: "active",
    args: (c) => ({ loanId: c.loanId }),
  },
  "loans:myRequests": { kind: "query", ref: api.loans.myRequests, needs: "none", args: () => ({}) },
  "loans:incoming": { kind: "query", ref: api.loans.incoming, needs: "none", args: () => ({}) },
  "loans:timeline": { kind: "query", ref: api.loans.timeline, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "users:syncMe": { kind: "mutation", ref: api.users.syncMe, needs: "none", args: () => ({}) },
  "users:me": { kind: "query", ref: api.users.me, needs: "none", args: () => ({}) },
  "admin:listLoans": { kind: "query", ref: api.admin.listLoans, needs: "none", args: () => ({}) },
  "admin:listTools": { kind: "query", ref: api.admin.listTools, needs: "none", args: () => ({}) },
  "admin:listUsers": { kind: "query", ref: api.admin.listUsers, needs: "none", args: () => ({}) },
  "admin:removeTool": {
    kind: "mutation",
    ref: api.admin.removeTool,
    needs: "none",
    args: (c) => ({ toolId: c.toolId, reason: "Policy check" }),
  },
  "admin:setTrustedLender": {
    kind: "mutation",
    ref: api.admin.setTrustedLender,
    needs: "none",
    args: (c) => ({ userId: c.alice.id, trusted: true }),
  },
  "admin:auditLog": { kind: "query", ref: api.admin.auditLog, needs: "none", args: () => ({}) },
};

test("every matrix row has an executable call and vice versa", () => {
  expect(Object.keys(CALLS).sort()).toEqual(MATRIX.map((row) => row.fn).sort());
});

function accessorFor(t: ReturnType<typeof setupTest>, w: World, actor: Actor) {
  switch (actor) {
    case "anonymous":
      return t;
    case "owner":
      return w.alice.as;
    case "borrower":
      return w.bob.as;
    case "otherUser":
      return w.carol.as;
    case "admin":
      return w.dana.as;
  }
}

describe.each(MATRIX)("$fn", (row) => {
  test.each([...ACTORS])("as %s", async (actor) => {
    const t = setupTest();
    const w = await seedWorld(t);
    const call = CALLS[row.fn];
    const loanId =
      call.needs === "none"
        ? ((undefined as unknown) as Id<"loans">)
        : await insertLoan(t, w, { status: call.needs });
    const who = accessorFor(t, w, actor);
    const args = call.args({ ...w, loanId });
    const promise =
      call.kind === "query"
        ? who.query(call.ref as FunctionReference<"query">, args)
        : who.mutation(call.ref as FunctionReference<"mutation">, args);

    const expected = row.expect[actor];
    if (expected === "allow") {
      await promise; // rejects → test fails with the real error
    } else {
      await expectCode(promise, expected);
    }
  });
});
```

- [ ] **Step 3: Write the coverage test**

`tests/static/authzCoverage.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { MATRIX } from "../authz/matrix";

const CONVEX_DIR = fileURLToPath(new URL("../../convex", import.meta.url));
const PUBLIC_EXPORT = /export const (\w+) = (publicQuery|identityMutation|userQuery|userMutation|adminQuery|adminMutation)\(/g;

test("every public Convex function appears in the authorization matrix", () => {
  const found: string[] = [];
  for (const entry of readdirSync(CONVEX_DIR)) {
    if (!entry.endsWith(".ts") || entry.split(".").length !== 2) continue;
    const source = readFileSync(join(CONVEX_DIR, entry), "utf8");
    for (const match of source.matchAll(PUBLIC_EXPORT)) {
      found.push(`${entry.replace(/\.ts$/, "")}:${match[1]}`);
    }
  }
  expect(found.sort()).toEqual(MATRIX.map((row) => row.fn).sort());
});
```

- [ ] **Step 4: Write the generator script**

`scripts/authz-matrix.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderMatrix } from "../tests/authz/matrix";

const target = fileURLToPath(new URL("../docs/authz-matrix.md", import.meta.url));
const next = renderMatrix();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // missing file counts as stale
  }
  if (current !== next) {
    console.error("docs/authz-matrix.md is stale. Run `pnpm docs:authz`.");
    process.exit(1);
  }
  console.log("docs/authz-matrix.md is up to date.");
} else {
  writeFileSync(target, next);
  console.log("Wrote docs/authz-matrix.md");
}
```

- [ ] **Step 5: Run the matrix and coverage tests**

Run: `pnpm vitest run convex/authz.test.ts tests/static/authzCoverage.test.ts`
Expected: PASS (24 functions × 5 actors = 120 cases plus 2 meta tests). A failing cell means either the function or the matrix is wrong; fix the function if it contradicts the spec §6, otherwise correct the matrix and note why in the commit.

- [ ] **Step 6: Generate the doc and verify the check mode**

Run: `pnpm docs:authz && pnpm docs:authz --check`
Expected: `Wrote docs/authz-matrix.md` then `docs/authz-matrix.md is up to date.`

- [ ] **Step 7: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests convex/authz.test.ts scripts docs/authz-matrix.md
git commit -m "test(authz): prove the authorization matrix and generate its doc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Clerk + Convex client wiring and claims spike

Requires the user (Adrian) to create a Clerk application. Stop and ask for the values in Step 1 before continuing.

**Files:**
- Create: `convex/auth.config.ts`, `app/ConvexClientProvider.tsx`, `proxy.ts`, temporary `app/whoami/page.tsx` (deleted in Step 8)
- Modify: `app/layout.tsx`, `.env.local` (not committed), `.env.example`, `docs/superpowers/specs/2026-10-31-lendloop-design.md` (§15 Clerk row result)

**Interfaces:**
- Produces: `<ConvexClientProvider>` wrapping the app inside `<ClerkProvider>`; `proxy.ts` protecting `/tools(.*)`, `/me(.*)`, `/loans(.*)`, `/admin(.*)` for UX redirects only.

- [ ] **Step 1: USER INPUT — Clerk setup**

Ask the user to:
1. Create a Clerk application (development instance).
2. In the Clerk dashboard, activate the **Convex integration**.
3. Under Sessions → Customize session token, add claims:
   ```json
   {
     "role": "{{user.public_metadata.role}}",
     "email": "{{user.primary_email_address}}",
     "name": "{{user.full_name}}"
   }
   ```
4. Share `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the Frontend API URL (e.g. `https://xxx.clerk.accounts.dev`).

- [ ] **Step 2: Configure env**

Add to `.env.local` (gitignored): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=…`, `CLERK_SECRET_KEY=…`. Then:

```bash
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev
pnpm exec convex env set APP_TIMEZONE UTC
```

- [ ] **Step 3: Add `convex/auth.config.ts` and push**

```ts
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

Run: `pnpm convex:push` → success.

- [ ] **Step 4: Add the client provider**

`app/ConvexClientProvider.tsx`:

```tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
```

In `app/layout.tsx`, import `ClerkProvider` from `@clerk/nextjs` and `ConvexClientProvider`, wrap the returned `<html>` in `<ClerkProvider>`, and wrap `{children}` inside `<body>` with `<ConvexClientProvider>`. Keep the scaffold's fonts for now (Plan 3 replaces them).

- [ ] **Step 5: Add `proxy.ts`**

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// UX only: redirects signed-out visitors away from app routes.
// Authorization is enforced in Convex functions, never here.
const isAppRoute = createRouteMatcher(["/tools(.*)", "/me(.*)", "/loans(.*)", "/admin(.*)", "/whoami"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAppRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 6: Temporary whoami page for the claims spike**

`app/whoami/page.tsx`:

```tsx
"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

function Me() {
  const syncMe = useMutation(api.users.syncMe);
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    void syncMe({}).then(() => setSynced(true));
  }, [syncMe]);
  const me = useQuery(api.users.me, synced ? {} : "skip");
  return <pre>{JSON.stringify(me ?? "loading", null, 2)}</pre>;
}

export default function WhoAmI() {
  return (
    <main style={{ padding: 24 }}>
      <Unauthenticated>
        <SignInButton />
      </Unauthenticated>
      <Authenticated>
        <UserButton />
        <Me />
      </Authenticated>
    </main>
  );
}
```

- [ ] **Step 7: Run the spike**

Run: `pnpm dev`, open `http://localhost:3000/whoami`, sign in.
Expected: JSON with your display name, email, `"role": "user"`. Then in the Clerk dashboard set your user's public metadata to `{"role": "admin"}`, wait up to 60 s (or sign out and in) and reload.
Expected: `"role": "admin"`. If `email` or the name is missing, fix the claim shortcodes in Clerk; if claims never arrive, fall back to a JWT template named `convex` with the same claims (spec §15) and record that.

- [ ] **Step 8: Clean up and record**

Delete `app/whoami/` and remove `"/whoami"` from `proxy.ts`. Update `.env.example` comments to list `CLERK_JWT_ISSUER_DOMAIN` and `APP_TIMEZONE` as Convex env vars. In the spec §15 table, append to the Clerk row: `**Result 2026-xx-xx: claims arrive via native Convex integration**` (or the fallback used).

- [ ] **Step 9: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (build needs the Clerk keys in `.env.local`).

```bash
git add convex/auth.config.ts app proxy.ts .env.example docs/superpowers/specs/2026-10-31-lendloop-design.md convex/_generated
git commit -m "feat(auth): wire Clerk to Convex and verify role/email/name claims

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Plan 1 exit criteria

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm docs:authz --check` all pass.
- Every public Convex function is in `docs/authz-matrix.md` and proven by `convex/authz.test.ts`.
- A signed-in Clerk user reaches Convex with `role`, `email` and `name` claims.
- Spike results for spec §15 rows 1 and 4 recorded in the spec.
