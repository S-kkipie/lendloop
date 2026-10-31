// Fictional demo data for local development, demos and the automation E2E.
// Internal only: it runs through `npx convex run seed:<fn>` with deploy access
// and is not callable from clients. Seeded users cannot sign in: their
// tokenIdentifier ("seed|<id>") never matches a real issuer.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { internalMutation } from "./lib/functions";
import type { Category, Condition } from "./lib/validators";
import { addDays } from "./model/dates";
import type { LoanStatus } from "./model/loanMachine";

const SEED = { actorType: "system", action: "seed" } as const;

async function seedTool(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  tool: { name: string; category: Category; condition: Condition; description: string },
) {
  const toolId = await ctx.db.insert("tools", { ownerId, ...tool, status: "listed", updatedAt: Date.now() });
  await audit(ctx, { ...SEED, entityType: "tool", entityId: toolId, toStatus: "listed" });
  return toolId;
}

async function seedLoan(
  ctx: MutationCtx,
  loan: {
    toolId: Id<"tools">;
    ownerId: Id<"users">;
    borrowerId: Id<"users">;
    startDate: string;
    endDate: string;
    status: LoanStatus;
  },
) {
  const now = Date.now();
  const loanId = await ctx.db.insert("loans", {
    ...loan,
    approvedAt: loan.status === "pending" ? undefined : now,
    handedOverAt: loan.status === "active" || loan.status === "returned" ? now : undefined,
    returnedAt: loan.status === "returned" ? now : undefined,
    closedAt: loan.status === "returned" ? now : undefined,
  });
  await audit(ctx, { ...SEED, entityType: "loan", entityId: loanId, toStatus: loan.status });
  return loanId;
}

/**
 * Creates the demo neighbours, tools and loans unless they already exist.
 * Shared by `seed:demo` and `devtools:resetDemo`.
 */
export async function seedDemo(ctx: MutationCtx): Promise<{ created: boolean }> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", "seed_marta"))
    .unique();
  if (existing) return { created: false };

  const person = async (id: string, name: string) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: `seed|${id}`,
      clerkId: `seed_${id}`,
      name,
      email: `${id}@example.com`,
      isTrustedLender: false,
    });
    await audit(ctx, { ...SEED, entityType: "user", entityId: userId });
    return userId;
  };
  const marta = await person("marta", "Marta Rodríguez");
  const joaquin = await person("joaquin", "Joaquín Pérez");
  const ana = await person("ana", "Ana López");

  const drill = await seedTool(ctx, marta, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18 V drill with two batteries and a set of bits.",
  });
  const ladder = await seedTool(ctx, marta, {
    name: "Extension ladder",
    category: "ladders",
    condition: "good",
    description: "Aluminium, reaches about 6 metres.",
  });
  const washer = await seedTool(ctx, marta, {
    name: "Pressure washer",
    category: "cleaning",
    condition: "like_new",
    description: "Comes with a patio cleaner attachment.",
  });
  const trimmer = await seedTool(ctx, joaquin, {
    name: "Hedge trimmer",
    category: "garden",
    condition: "good",
    description: "Electric, 50 cm blade.",
  });
  await seedTool(ctx, joaquin, {
    name: "Camping stove",
    category: "camping",
    condition: "good",
    description: "Two burners, gas canister not included.",
  });
  await seedTool(ctx, joaquin, {
    name: "Socket wrench set",
    category: "hand_tools",
    condition: "like_new",
    description: "Metric sockets from 8 to 24 mm.",
  });
  await seedTool(ctx, ana, {
    name: "Stand mixer",
    category: "kitchen",
    condition: "like_new",
    description: "With dough hook, whisk and paddle.",
  });
  await seedTool(ctx, ana, {
    name: "Folding table",
    category: "other",
    condition: "fair",
    description: "Seats six, a few scratches on top.",
  });

  const t0 = today();
  await seedLoan(ctx, {
    toolId: drill,
    ownerId: marta,
    borrowerId: ana,
    startDate: addDays(t0, 3),
    endDate: addDays(t0, 5),
    status: "pending",
  });
  await seedLoan(ctx, {
    toolId: washer,
    ownerId: marta,
    borrowerId: joaquin,
    startDate: addDays(t0, 7),
    endDate: addDays(t0, 9),
    status: "approved",
  });
  await seedLoan(ctx, {
    toolId: ladder,
    ownerId: marta,
    borrowerId: joaquin,
    startDate: addDays(t0, -10),
    endDate: addDays(t0, -3),
    status: "active",
  });
  await seedLoan(ctx, {
    toolId: trimmer,
    ownerId: joaquin,
    borrowerId: ana,
    startDate: addDays(t0, -20),
    endDate: addDays(t0, -15),
    status: "returned",
  });
  return { created: true };
}

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => await seedDemo(ctx),
});

// A fresh active loan that ended 3 days ago, so an E2E run can prove a
// reminder is sent even when the demo loan was already reminded today.
export const overdueLoan = internalMutation({
  args: { ownerId: v.id("users"), borrowerId: v.id("users") },
  handler: async (ctx, { ownerId, borrowerId }) => {
    const toolId = await seedTool(ctx, ownerId, {
      name: "Wheelbarrow",
      category: "garden",
      condition: "fair",
      description: "Single wheel, holds about 80 litres.",
    });
    const t0 = today();
    const loanId = await seedLoan(ctx, {
      toolId,
      ownerId,
      borrowerId,
      startDate: addDays(t0, -6),
      endDate: addDays(t0, -3),
      status: "active",
    });
    return { toolId, loanId };
  },
});
