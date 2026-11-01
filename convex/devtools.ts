// Local-development maintenance for the demo database. Internal only: these
// run through `npx convex run devtools:<fn>` with deploy access and are not
// callable from clients. Both refuse to run unless the deployment sets
// ALLOW_DEV_TOOLS=true, which only a local deployment should ever do, so even
// a leaked production deploy key can't wipe data through them.
//   pnpm db:reset-demo                      empty the app tables, then re-seed
//   npx convex run devtools:purgeE2E        remove what the automation E2E created
//   npx convex run devtools:purgeE2E '{"clerkIds":["user_…"]}'
//                                           also remove these users (the Playwright
//                                           suite's real Clerk test accounts)
import { v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appError } from "./lib/errors";
import { internalMutation } from "./lib/functions";
import type { EntityType } from "./lib/validators";
import { seedDemo } from "./seed";

/** Every table the app owns (component tables, like the rate limiter's, are not ours). */
export const APP_TABLES = [
  "users",
  "tools",
  "loans",
  "outboxEvents",
  "reminders",
  "automationErrors",
  "automationHeartbeats",
  "auditLog",
] as const satisfies readonly TableNames[];

/** Users the automation E2E creates: their Clerk subject starts with this. */
export const E2E_CLERK_PREFIX = "e2e_";
/** Explicit clerkIds per call (the Playwright suite passes its two test users). */
export const MAX_PURGE_CLERK_IDS = 20;

function requireDevTools(): void {
  if (process.env.ALLOW_DEV_TOOLS !== "true") {
    throw appError("FORBIDDEN", "Dev tools are off on this deployment (ALLOW_DEV_TOOLS is not \"true\")");
  }
}

// Demo-sized data: one transaction reads and deletes everything (well inside
// Convex's per-mutation limits for a local database).
async function deleteAll(ctx: MutationCtx, table: (typeof APP_TABLES)[number]): Promise<number> {
  const rows = await ctx.db.query(table).collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const resetDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDevTools();
    const deleted: Record<string, number> = {};
    for (const table of APP_TABLES) deleted[table] = await deleteAll(ctx, table);
    const { created } = await seedDemo(ctx);
    return { deleted, seeded: created };
  },
});

export const purgeE2E = internalMutation({
  // Users whose clerkId starts with "e2e_", plus any listed here: Clerk test
  // accounts get real Clerk IDs ("user_…"), so the prefix can't find them.
  args: { clerkIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    requireDevTools();
    const listed = [...new Set(args.clerkIds ?? [])];
    if (listed.length > MAX_PURGE_CLERK_IDS) {
      throw appError("INVALID", `At most ${MAX_PURGE_CLERK_IDS} clerkIds per call`);
    }
    // Index range for the prefix: "`" is the character right after "_".
    const prefixed = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.gte("clerkId", E2E_CLERK_PREFIX).lt("clerkId", "e2e`"))
      .collect();
    const users = [...prefixed];
    for (const clerkId of listed) {
      if (clerkId.startsWith(E2E_CLERK_PREFIX)) continue; // already in the range above
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
        .unique();
      if (user) users.push(user);
    }
    const userIds = new Set<Id<"users">>(users.map((u) => u._id));

    const tools: Doc<"tools">[] = [];
    const loans = new Map<Id<"loans">, Doc<"loans">>();
    for (const user of users) {
      tools.push(
        ...(await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect()),
      );
      const owned = await ctx.db
        .query("loans")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", user._id))
        .collect();
      const borrowed = await ctx.db
        .query("loans")
        .withIndex("by_borrower_status", (q) => q.eq("borrowerId", user._id))
        .collect();
      for (const loan of [...owned, ...borrowed]) loans.set(loan._id, loan);
    }
    const toolIds = new Set<Id<"tools">>(tools.map((t) => t._id));

    // Events for those loans or tools, or addressed to an E2E user.
    const events = (await ctx.db.query("outboxEvents").collect()).filter(
      (e) =>
        userIds.has(e.recipientId) ||
        (e.loanId !== undefined && loans.has(e.loanId)) ||
        (e.toolId !== undefined && toolIds.has(e.toolId)),
    );
    const eventIds = new Set<Id<"outboxEvents">>(events.map((e) => e._id));
    // Automation errors the run caused (they point at its events).
    const errors = (await ctx.db.query("automationErrors").collect()).filter(
      (e) => e.eventId !== undefined && eventIds.has(e.eventId),
    );
    const reminders: Doc<"reminders">[] = [];
    for (const loanId of loans.keys()) {
      reminders.push(
        ...(await ctx.db
          .query("reminders")
          .withIndex("by_loan", (q) => q.eq("loanId", loanId))
          .collect()),
      );
    }

    // Audit rows about any of those entities.
    const entities: [EntityType, string][] = [
      ...users.map((u): [EntityType, string] => ["user", u._id]),
      ...tools.map((t): [EntityType, string] => ["tool", t._id]),
      ...[...loans.keys()].map((id): [EntityType, string] => ["loan", id]),
      ...events.map((e): [EntityType, string] => ["outboxEvent", e._id]),
      ...errors.map((e): [EntityType, string] => ["automationError", e._id]),
    ];
    const audits: Doc<"auditLog">[] = [];
    for (const [entityType, entityId] of entities) {
      audits.push(
        ...(await ctx.db
          .query("auditLog")
          .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
          .collect()),
      );
    }

    const doomed = [...audits, ...reminders, ...errors, ...events, ...loans.values(), ...tools, ...users];
    for (const row of doomed) await ctx.db.delete(row._id);
    return {
      users: users.length,
      tools: tools.length,
      loans: loans.size,
      outboxEvents: events.length,
      reminders: reminders.length,
      automationErrors: errors.length,
      auditLog: audits.length,
    };
  },
});
