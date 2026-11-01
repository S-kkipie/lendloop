// End-to-end check of the automation loop against the local stack. Requires
// `pnpm dev:convex` (Convex local deployment with ALLOW_DEV_TOOLS=true) and
// `pnpm stack:up` (n8n, Postgres, Mailpit). Prints a PASS/FAIL table and exits
// 1 on any failure. Never prints secrets or full email addresses. Whatever the
// outcome, it removes the users, tools and loans it created (devtools:purgeE2E),
// so repeated runs don't pile up in the demo data.
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maskEmail } from "../convex/lib/displayName";
import { addDays, todayIn } from "../convex/model/dates";
import { parseEnv } from "./lib/envfile";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const env = parseEnv(readFileSync(`${ROOT}n8n/.env`, "utf8"));
const MAILPIT = `http://localhost:${env.get("MAILPIT_UI_PORT") || "8025"}`;
const N8N = "http://localhost:5678";
const WEBHOOK_PATH = "/webhook/lendloop-loan-events";
const CONVEX_SITE = "http://127.0.0.1:3211";
const ISSUER = "https://e2e.lendloop.local";
const COMPOSE = ["compose", "--env-file", "n8n/.env"];

type Json = Record<string, unknown>;
type Identity = Json & { subject: string; email: string };
type Message = { ID: string; Subject: string; To: { Address: string }[] };
type OutboxEvent = { _id: string; loanId?: string; type: string; status: string; replayOf?: string };

const results: { step: string; ok: boolean; detail: string }[] = [];
const maskAll = (text: string) => text.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, (email) => maskEmail(email) ?? "***");

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail: maskAll(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${maskAll(detail)}`);
}

function sh(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} failed: ${maskAll(String(result.stderr)).slice(-400)}`);
  }
  return String(result.stdout);
}

function convex(fn: string, args: Json = {}, who?: Identity): unknown {
  const identity = who ? ["--identity", JSON.stringify(who)] : [];
  const out = sh("pnpm", ["exec", "convex", "run", ...identity, fn, JSON.stringify(args)]).trim();
  return out ? JSON.parse(out) : null; // `convex run` prints nothing for null
}

function table<T>(name: string, limit = 200): T[] {
  const out = sh("pnpm", ["exec", "convex", "data", name, "--limit", String(limit), "--format", "jsonLines"]);
  return out
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as T);
}

async function until<T>(timeoutMs: number, probe: () => Promise<T | undefined> | T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

async function messages(): Promise<Message[]> {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=500`);
  return ((await response.json()) as { messages: Message[] }).messages;
}

async function mailTo(email: string, subject: string): Promise<Message[]> {
  return (await messages()).filter(
    (m) => m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()) && m.Subject.includes(subject),
  );
}

async function chaos(triggers: Json) {
  const response = await fetch(`${MAILPIT}/api/v1/chaos`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(triggers),
  });
  if (!response.ok) throw new Error(`Mailpit chaos API answered ${response.status}`);
}

const eventsFor = (loanId: string) => table<OutboxEvent>("outboxEvents").filter((e) => e.loanId === loanId);

async function signedPost(body: string, eventId: string, secret: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${ts}.POST.${WEBHOOK_PATH}.${body}`, "utf8").digest("hex");
  const response = await fetch(`${N8N}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": ts,
      "x-lendloop-signature": `v1=${signature}`,
      "x-lendloop-event-id": eventId,
    },
    body,
  });
  return { status: response.status, text: await response.text() };
}

function runReminders(): void {
  // 5679 belongs to the running n8n's task broker; the CLI process needs its own.
  sh("docker", [...COMPOSE, "exec", "-T", "-e", "N8N_RUNNERS_BROKER_PORT=5680", "n8n", "n8n", "execute", "--id=llOverdueRemind01"]);
}

const identity = (id: string, name: string, extra: Json = {}): Identity => ({
  subject: id,
  issuer: ISSUER,
  tokenIdentifier: `${ISSUER}|${id}`,
  name,
  email: `${id}@example.com`,
  ...extra,
});

async function main() {
  const health = await Promise.all([
    fetch(`${CONVEX_SITE}/health`).then((r) => r.ok, () => false),
    fetch(`${N8N}/healthz`).then((r) => r.ok, () => false),
    fetch(`${MAILPIT}/api/v1/info`).then((r) => r.ok, () => false),
  ]);
  record("stack is up (Convex, n8n, Mailpit)", health.every(Boolean), `convex=${health[0]} n8n=${health[1]} mailpit=${health[2]}`);
  if (!health.every(Boolean)) return;

  // 1-2. Demo seed and an empty inbox.
  const seeded = convex("seed:demo") as { created: boolean };
  record("seed:demo", true, seeded.created ? "created" : "already seeded");
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  // 3. Two fresh neighbours (unique per run), a tool and a request.
  const run = randomBytes(3).toString("hex");
  const owner = identity(`e2e_owner_${run}`, "Olivia Owner");
  const borrower = identity(`e2e_borrower_${run}`, "Bruno Borrower");
  const admin = identity("e2e_admin", "Ada Admin", { role: "admin" });
  const ownerId = convex("users:syncMe", {}, owner) as string;
  const borrowerId = convex("users:syncMe", {}, borrower) as string;
  convex("users:syncMe", {}, admin);
  const today = todayIn(env.get("GENERIC_TIMEZONE") || "UTC");
  const tool = (name: string) =>
    convex(
      "tools:create",
      { name, category: "power_tools", condition: "good", description: "Created by the automation E2E." },
      owner,
    ) as string;
  const request = (toolId: string) =>
    convex("loans:request", { toolId, startDate: addDays(today, 2), endDate: addDays(today, 3) }, borrower) as string;
  const health0 = convex("admin:automationHealth", {}, admin) as { counts: { sent: number } };
  const loanId = request(tool(`E2E drill ${run}`));

  // 4. Email to the owner, then the signed write-back marks the event sent.
  const first = await until(30_000, async () => {
    const found = await mailTo(owner.email, "wants to borrow");
    return found.length ? found : undefined;
  });
  record("email on request", Boolean(first), first ? `"${first[0].Subject}" to ${owner.email}` : "no email within 30 s");
  const sent = await until(30_000, () => eventsFor(loanId).find((e) => e.type === "loan.requested" && e.status === "sent"));
  const health1 = convex("admin:automationHealth", {}, admin) as { counts: { sent: number } };
  record(
    "write-back marks the event sent",
    Boolean(sent) && health1.counts.sent >= 1,
    `event ${sent ? "sent" : "not sent"}, counts.sent ${health0.counts.sent} -> ${health1.counts.sent}`,
  );

  // 5. Same event ID again: duplicate, no second email. A forgery is rejected.
  const secret = env.get("LENDLOOP_N8N_WEBHOOK_SECRET") ?? "";
  if (sent) {
    const payload = convex("automation/delivery:payloadFor", { eventId: sent._id });
    const again = await signedPost(JSON.stringify(payload), sent._id, secret);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const count = (await mailTo(owner.email, "wants to borrow")).length;
    record(
      "repeated event ID is a duplicate",
      again.status === 200 && again.text === '{"duplicate":true}' && count === 1,
      `HTTP ${again.status} ${again.text}, owner emails: ${count}`,
    );
    const forged = await signedPost(JSON.stringify(payload), sent._id, "not-the-secret-0123456789abcdef01234567");
    record("forged signature is rejected", forged.status === 401, `HTTP ${forged.status} ${forged.text}`);
    // After `pnpm setup:local --rotate`, n8n still accepts the previous secret
    // (a 200 duplicate, not a 401), so events Convex signed before the switch land.
    const previous = env.get("LENDLOOP_N8N_WEBHOOK_SECRET_PREVIOUS") ?? "";
    if (previous && previous !== secret) {
      const old = await signedPost(JSON.stringify(payload), sent._id, previous);
      record(
        "previous secret is still accepted (rotation)",
        old.status === 200 && old.text === '{"duplicate":true}',
        `HTTP ${old.status} ${old.text}`,
      );
    } else {
      record("previous secret is still accepted (rotation)", true, "skipped: no rotation in progress");
    }
  } else {
    record("repeated event ID is a duplicate", false, "skipped: no sent event");
  }

  // 6. Reminders: a fresh overdue loan gets exactly one reminder per day.
  const overdue = convex("seed:overdueLoan", { ownerId, borrowerId }) as { loanId: string };
  runReminders();
  const reminder = await until(30_000, async () => {
    const found = await mailTo(borrower.email, "Reminder: please return the Wheelbarrow");
    return found.length ? found : undefined;
  });
  const reminderRow = await until(15_000, () =>
    table<{ loanId: string; status: string }>("reminders").find((r) => r.loanId === overdue.loanId && r.status === "sent"),
  );
  const health2 = convex("admin:automationHealth", {}, admin) as {
    reminders24h: { sent: number };
    heartbeat: { stale: boolean };
  };
  const demoReminder = (await mailTo("joaquin@example.com", "Reminder: please return")).length;
  record(
    "overdue reminder sent and recorded",
    Boolean(reminder) && Boolean(reminderRow) && health2.reminders24h.sent >= 1 && !health2.heartbeat.stale,
    `email ${reminder ? "received" : "missing"}, reminder row ${reminderRow ? "sent" : "missing"}, ` +
      `reminders24h.sent ${health2.reminders24h.sent}, heartbeat stale ${health2.heartbeat.stale}, ` +
      `demo borrower reminders this run: ${demoReminder}`,
  );
  runReminders();
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const reminders = (await mailTo(borrower.email, "Reminder: please return")).length;
  record("second reminder run sends nothing", reminders === 1, `borrower reminders: ${reminders}`);

  // 7. SMTP failing: the send fails after its retries and Convex marks the event
  // failed. Mailpit chaos rejects every recipient with a 451, which fails fast and
  // deterministically (a stopped container fails after variable network timeouts,
  // and a retry may then succeed once it is back).
  let failed: OutboxEvent | undefined;
  let failureErrorId: string | undefined;
  await chaos({ Recipient: { ErrorCode: 451, Probability: 100 } });
  try {
    const failingLoan = request(tool(`E2E sander ${run}`));
    failed = await until(90_000, () => eventsFor(failingLoan).find((e) => e.type === "loan.requested" && e.status === "failed"));
    const health3 = convex("admin:automationHealth", {}, admin) as {
      errors: { _id: string; eventId?: string; workflow: string; node?: string }[];
      problems: { _id: string }[];
    };
    const error = health3.errors.find((e) => failed && e.eventId === failed._id);
    failureErrorId = error?._id;
    record(
      "SMTP failure reaches Convex",
      Boolean(failed) && Boolean(error) && health3.problems.some((p) => p._id === failed?._id),
      failed ? `event failed; error from ${error?.workflow}/${error?.node}` : "event not failed within 90 s",
    );
  } finally {
    await chaos({});
  }

  // 8. The admin replay (a new event ID) delivers once SMTP works again.
  if (failed) {
    const replayId = convex("admin:replayEvent", { eventId: failed._id }, admin) as string;
    const replayed = await until(60_000, async () => {
      const found = await mailTo(owner.email, `wants to borrow your E2E sander ${run}`);
      return found.length ? found : undefined;
    });
    const replaySent = await until(30_000, () =>
      table<OutboxEvent>("outboxEvents").find((e) => e._id === replayId && e.status === "sent"),
    );
    record(
      "replay after failure is delivered",
      Boolean(replayed) && Boolean(replaySent),
      `email ${replayed ? "received" : "missing"}, replay event ${replaySent ? "sent" : "not sent"}`,
    );
  }

  // Tidy up: the overdue fixture is returned so it is not reminded again, and
  // the error this run caused on purpose is resolved.
  convex("loans:markReturned", { loanId: overdue.loanId }, owner);
  if (failureErrorId) convex("admin:resolveError", { errorId: failureErrorId }, admin);
}

// Every run creates fresh e2e_* users; delete them and everything they touched,
// also when a step failed. Leaves the seed data and real accounts alone.
function cleanUp(): void {
  try {
    const purged = convex("devtools:purgeE2E") as Record<string, number>;
    const summary = Object.entries(purged)
      .map(([table, count]) => `${table} ${count}`)
      .join(", ");
    record("clean up E2E data", true, summary);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    record(
      "clean up E2E data",
      false,
      /ALLOW_DEV_TOOLS/.test(reason)
        ? "dev tools are off: run `pnpm exec convex env set ALLOW_DEV_TOOLS true` on the local deployment"
        : reason,
    );
  }
}

main()
  .catch((error: unknown) => record("unexpected error", false, error instanceof Error ? error.message : String(error)))
  .finally(() => {
    cleanUp();
    const width = Math.max(...results.map((r) => r.step.length));
    console.log(`\n${"Result".padEnd(6)}  ${"Step".padEnd(width)}  Detail`);
    for (const r of results) console.log(`${(r.ok ? "PASS" : "FAIL").padEnd(6)}  ${r.step.padEnd(width)}  ${r.detail}`);
    const failures = results.filter((r) => !r.ok).length;
    console.log(failures ? `\n${failures} step(s) failed.` : "\nAll steps passed.");
    process.exitCode = failures ? 1 : 0;
  });
