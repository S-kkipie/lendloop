import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { log, sanitizeError } from "../lib/logger";

export const recordError = internalMutation({
  args: {
    workflow: v.string(),
    executionId: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    eventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationErrors")
      .withIndex("by_executionId", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { duplicate: true };

    const eventId = args.eventId ? ctx.db.normalizeId("outboxEvents", args.eventId) : null;
    const message = sanitizeError(args.message, 500);
    await ctx.db.insert("automationErrors", {
      workflow: args.workflow.slice(0, 100),
      executionId: args.executionId.slice(0, 100),
      node: args.node?.slice(0, 100),
      message,
      eventId: eventId ?? undefined,
    });
    if (eventId) {
      const event = await ctx.db.get(eventId);
      if (event && event.status !== "sent") {
        await ctx.db.patch(eventId, { status: "failed", lastError: message, nextAttemptAt: undefined });
      }
    }
    log.error("automation.error", { workflow: args.workflow, executionId: args.executionId, node: args.node });
    return { duplicate: false };
  },
});
