import { v } from "convex/values";
import { REMINDER_WORKFLOW } from "./automation/heartbeat";
import { enqueueEvent } from "./automation/outbox";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { displayName, maskEmail } from "./lib/displayName";
import { appError } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { nameOf, summarizeLoan } from "./lib/loanAccess";
import { removeToolCascade } from "./lib/tools";
import { LIMITS, OUTBOX_STATUSES, vEntityType, vLoanStatus, type OutboxStatus } from "./lib/validators";
import { isStale } from "./model/heartbeat";

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

export const automationHealth = adminQuery({
  args: {},
  handler: async (ctx) => {
    const counts = {} as Record<OutboxStatus, number>;
    for (const status of OUTBOX_STATUSES) {
      counts[status] = (
        await ctx.db
          .query("outboxEvents")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(1000)
      ).length;
    }
    const problems = [];
    for (const status of ["dead", "failed"] as const) {
      const rows = await ctx.db
        .query("outboxEvents")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(25);
      problems.push(
        ...rows.map((e) => ({
          _id: e._id,
          type: e.type,
          status: e.status,
          attempts: e.attempts,
          lastError: e.lastError,
          loanId: e.loanId,
          at: e._creationTime,
        })),
      );
    }
    const errors = (
      await ctx.db
        .query("automationErrors")
        .withIndex("by_resolved", (q) => q.eq("resolvedAt", undefined))
        .order("desc")
        .take(50)
    ).map((e) => ({
      _id: e._id,
      workflow: e.workflow,
      executionId: e.executionId,
      node: e.node,
      message: e.message,
      eventId: e.eventId,
      at: e._creationTime,
    }));
    const beat = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    const since = Date.now() - 24 * 3_600_000;
    const recent = (await ctx.db.query("reminders").order("desc").take(500)).filter((r) => r._creationTime >= since);
    return {
      counts,
      problems: problems.sort((a, b) => b.at - a.at),
      errors,
      heartbeat: {
        lastCheckInAt: beat?.lastCheckInAt ?? null,
        stale: isStale(beat?.lastCheckInAt ?? null, Date.now()),
      },
      reminders24h: {
        sent: recent.filter((r) => r.status === "sent").length,
        failed: recent.filter((r) => r.status === "failed").length,
      },
    };
  },
});

export const replayEvent = adminMutation({
  args: { eventId: v.id("outboxEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw appError("NOT_FOUND", "Event not found");
    if (event.status !== "dead" && event.status !== "failed") {
      throw appError("CONFLICT", "Only failed or dead events can be replayed");
    }
    // A replay is a new intent with a new event ID, so n8n's dedupe of the
    // original ID does not swallow it.
    const replayId = await enqueueEvent(ctx, {
      type: event.type,
      recipientId: event.recipientId,
      loanId: event.loanId,
      toolId: event.toolId,
      replayOf: event._id,
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "admin",
      action: "outboxEvent.replay",
      entityType: "outboxEvent",
      entityId: event._id,
    });
    return replayId;
  },
});

export const resolveError = adminMutation({
  args: { errorId: v.id("automationErrors") },
  handler: async (ctx, { errorId }) => {
    const error = await ctx.db.get(errorId);
    if (!error) throw appError("NOT_FOUND", "Error not found");
    if (error.resolvedAt !== undefined) return null;
    await ctx.db.patch(errorId, { resolvedAt: Date.now(), resolvedBy: ctx.user._id });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "admin",
      action: "automationError.resolve",
      entityType: "automationError",
      entityId: errorId,
    });
    return null;
  },
});
