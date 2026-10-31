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
    await ctx.db.patch(
      userId,
      trusted
        ? { isTrustedLender: true, trustedAt: Date.now(), trustedBy: ctx.user._id }
        : { isTrustedLender: false, trustedAt: undefined, trustedBy: undefined },
    );
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
