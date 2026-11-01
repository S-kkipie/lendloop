import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { APP_TABLES } from "./devtools";
import { NOW, expectCode, insertLoan, seedWorld, setupTest, type TestT } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // today = 2026-11-02 (UTC)
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Every app row without ids or timestamps, so two databases can be compared. */
async function contents(t: TestT) {
  return await t.run(async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const tools = await ctx.db.query("tools").collect();
    const loans = await ctx.db.query("loans").collect();
    const clerkIdOf = new Map(users.map((u) => [u._id, u.clerkId]));
    const toolNameOf = new Map(tools.map((tool) => [tool._id, tool.name]));
    const counts: Record<string, number> = {};
    for (const table of APP_TABLES) counts[table] = (await ctx.db.query(table).collect()).length;
    return {
      counts,
      users: users.map((u) => u.clerkId).sort(),
      tools: tools.map((tool) => `${clerkIdOf.get(tool.ownerId)}:${tool.name}:${tool.status}`).sort(),
      loans: loans
        .map((l) => `${toolNameOf.get(l.toolId)}:${clerkIdOf.get(l.borrowerId)}:${l.status}:${l.startDate}`)
        .sort(),
    };
  });
}

const e2eIdentity = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  subject: id,
  issuer: "https://e2e.lendloop.local",
  tokenIdentifier: `https://e2e.lendloop.local|${id}`,
  name,
  email: `${id}@example.com`,
  ...extra,
});

describe("guard", () => {
  test.each([undefined, "", "false", "1", "TRUE"])("both refuse when ALLOW_DEV_TOOLS is %o", async (value) => {
    if (value !== undefined) vi.stubEnv("ALLOW_DEV_TOOLS", value);
    const t = setupTest();
    await t.mutation(internal.seed.demo, {});
    const before = await contents(t);
    await expectCode(t.mutation(internal.devtools.resetDemo, {}), "FORBIDDEN");
    await expectCode(t.mutation(internal.devtools.purgeE2E, {}), "FORBIDDEN");
    await expectCode(t.mutation(internal.devtools.purgeE2E, { clerkIds: ["seed_marta"] }), "FORBIDDEN");
    expect(await contents(t)).toEqual(before);
  });
});

describe("resetDemo", () => {
  test("leaves exactly the seed data", async () => {
    const fresh = setupTest();
    await fresh.mutation(internal.seed.demo, {});
    const seedOnly = await contents(fresh);

    // A polluted database: seed data, a real user's listing and loan, and
    // automation rows of every kind.
    const t = setupTest();
    await t.mutation(internal.seed.demo, {});
    const w = await seedWorld(t);
    const loanId = await w.bob.as.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-05",
      endDate: "2026-11-07",
    });
    await insertLoan(t, w, { status: "returned", startDate: "2026-10-01", endDate: "2026-10-03" });
    await t.run(async (ctx) => {
      await ctx.db.insert("reminders", {
        loanId,
        idempotencyKey: `${loanId}:2026-11-02`,
        status: "sent",
        n8nExecutionId: "41",
      });
      await ctx.db.insert("automationErrors", { workflow: "loan-notifications", executionId: "42", message: "SMTP 451" });
      await ctx.db.insert("automationHeartbeats", { workflow: "overdue-reminders", lastCheckInAt: Date.now() });
    });

    vi.stubEnv("ALLOW_DEV_TOOLS", "true");
    const result = await t.mutation(internal.devtools.resetDemo, {});

    expect(result.seeded).toBe(true);
    expect(result.deleted.users).toBe(seedOnly.counts.users + 4);
    expect(await contents(t)).toEqual(seedOnly);
    // The seed has no automation rows of its own.
    expect(seedOnly.counts).toMatchObject({ outboxEvents: 0, reminders: 0, automationErrors: 0, automationHeartbeats: 0 });
  });
});

describe("purgeE2E", () => {
  test("removes only what E2E users created, and every row that points at it", async () => {
    const t = setupTest();
    await t.mutation(internal.seed.demo, {});
    // A real (non-E2E) neighbour with a listing and a request from a seed user.
    const w = await seedWorld(t);
    await w.bob.as.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-05", endDate: "2026-11-07" });
    const keep = await contents(t);

    // What one E2E run leaves behind.
    const owner = t.withIdentity(e2eIdentity("e2e_owner_a1b2c3", "Olivia Owner"));
    const borrower = t.withIdentity(e2eIdentity("e2e_borrower_a1b2c3", "Bruno Borrower"));
    const admin = t.withIdentity(e2eIdentity("e2e_admin", "Ada Admin", { role: "admin" }));
    const ownerId = await owner.mutation(api.users.syncMe, {});
    const borrowerId = await borrower.mutation(api.users.syncMe, {});
    await admin.mutation(api.users.syncMe, {});
    const drill = await owner.mutation(api.tools.create, {
      name: "E2E drill a1b2c3",
      category: "power_tools",
      condition: "good",
      description: "Created by the automation E2E.",
    });
    const loanId = await borrower.mutation(api.loans.request, { toolId: drill, startDate: "2026-11-04", endDate: "2026-11-05" });
    // The E2E borrower also asks for a real neighbour's tool.
    const crossLoan = await borrower.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });
    const overdue = await t.mutation(internal.seed.overdueLoan, { ownerId, borrowerId });
    const eventId = await t.run(async (ctx) => {
      const event = (await ctx.db.query("outboxEvents").collect()).find((e) => e.loanId === loanId)!;
      await ctx.db.patch(event._id, { status: "failed", lastError: "SMTP 451" });
      await ctx.db.insert("reminders", {
        loanId: overdue.loanId,
        idempotencyKey: `${overdue.loanId}:2026-11-02`,
        status: "sent",
        n8nExecutionId: "7",
      });
      await ctx.db.insert("automationErrors", {
        workflow: "loan-notifications",
        executionId: "8",
        message: "SMTP 451",
        eventId: event._id,
      });
      return event._id;
    });
    await admin.mutation(api.admin.replayEvent, { eventId });

    vi.stubEnv("ALLOW_DEV_TOOLS", "true");
    const result = await t.mutation(internal.devtools.purgeE2E, {});

    expect(result).toMatchObject({ users: 3, tools: 2, loans: 3, reminders: 1, automationErrors: 1 });
    // The real neighbour's tool had an E2E request on it: the request goes,
    // the tool and its other request stay. So does everything else.
    expect(await contents(t)).toEqual(keep);
    const leftovers = await t.run(async (ctx) => {
      const purgedIds = new Set<string>([ownerId, borrowerId, drill, overdue.toolId, loanId, crossLoan, overdue.loanId, eventId]);
      return {
        events: (await ctx.db.query("outboxEvents").collect()).filter(
          (e) => purgedIds.has(e.recipientId) || (e.loanId && purgedIds.has(e.loanId)),
        ),
        audits: (await ctx.db.query("auditLog").collect()).filter((a) => purgedIds.has(a.entityId)),
        errors: await ctx.db.query("automationErrors").collect(),
        reminders: await ctx.db.query("reminders").collect(),
      };
    });
    expect(leftovers).toEqual({ events: [], audits: [], errors: [], reminders: [] });
  });

  test("also removes explicitly listed users (Playwright's Clerk test accounts) and what they touched", async () => {
    const t = setupTest();
    await t.mutation(internal.seed.demo, {});
    const w = await seedWorld(t);
    const keep = await contents(t);
    const owner = t.withIdentity(e2eIdentity("user_2pwOwner", "Odalys Ownerton"));
    const borrower = t.withIdentity(e2eIdentity("user_2pwBorrower", "Bertil Borrowman"));
    await owner.mutation(api.users.syncMe, {});
    await borrower.mutation(api.users.syncMe, {});
    const tool = await owner.mutation(api.tools.create, {
      name: "Playwright ladder",
      category: "ladders",
      condition: "good",
      description: "",
    });
    await borrower.mutation(api.loans.request, { toolId: tool, startDate: "2026-11-04", endDate: "2026-11-05" });
    await borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: "2026-11-10", endDate: "2026-11-11" });

    vi.stubEnv("ALLOW_DEV_TOOLS", "true");
    // Without the list, real Clerk IDs are out of reach of the prefix.
    expect(await t.mutation(internal.devtools.purgeE2E, {})).toMatchObject({ users: 0 });
    const result = await t.mutation(internal.devtools.purgeE2E, {
      clerkIds: ["user_2pwOwner", "user_2pwBorrower", "user_2pwBorrower", "user_unknown"],
    });
    expect(result).toMatchObject({ users: 2, tools: 1, loans: 2 });
    expect(await contents(t)).toEqual(keep);
  });

  test("rejects an oversized clerkIds list", async () => {
    const t = setupTest();
    vi.stubEnv("ALLOW_DEV_TOOLS", "true");
    const clerkIds = Array.from({ length: 21 }, (_, i) => `user_${i}`);
    await expectCode(t.mutation(internal.devtools.purgeE2E, { clerkIds }), "INVALID");
  });

  test("is a no-op when there is nothing to purge", async () => {
    const t = setupTest();
    await t.mutation(internal.seed.demo, {});
    const before = await contents(t);
    vi.stubEnv("ALLOW_DEV_TOOLS", "true");
    expect(await t.mutation(internal.devtools.purgeE2E, {})).toMatchObject({ users: 0, tools: 0, loans: 0 });
    expect(await contents(t)).toEqual(before);
  });
});
