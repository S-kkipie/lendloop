import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { displayName } from "./lib/displayName";
import { appError } from "./lib/errors";
import { publicQuery, userMutation, userQuery } from "./lib/functions";
import { enforceLimit } from "./lib/rateLimits";
import { activeLoanFor, availabilityOf, blockingLoans, cleanToolFields, removeToolCascade } from "./lib/tools";
import { vCategory, vCondition, type Category } from "./lib/validators";

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
    const available: { _id: Id<"tools">; name: string; category: Category }[] = [];
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
    const viewer = { userId: ctx.user._id, isAdmin: ctx.role === "admin" };
    const from = today();
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
        availability: availabilityOf(active, viewer, from),
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
      availability: availabilityOf(
        await activeLoanFor(ctx, toolId),
        { userId: ctx.user._id, isAdmin: ctx.role === "admin" },
        from,
      ),
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
        availability: availabilityOf(active, { userId: ctx.user._id, isAdmin: false }, today()), // own tools: always dated
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

async function loadOwnListedTool(ctx: QueryCtx & { user: Doc<"users"> }, toolId: Id<"tools">) {
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
