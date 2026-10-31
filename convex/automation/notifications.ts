import { v } from "convex/values";
import { internalMutation } from "../lib/functions";

// n8n confirms the email was actually sent. This may arrive before Convex has
// recorded "delivered", so any state except "skipped" can move to "sent".
export const recordNotificationStatus = internalMutation({
  args: { eventId: v.string(), status: v.literal("sent"), executionId: v.string() },
  handler: async (ctx, args) => {
    const eventId = ctx.db.normalizeId("outboxEvents", args.eventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    if (!event) return { found: false as const };
    if (event.status === "sent" || event.status === "skipped") return { found: true as const, updated: false };
    await ctx.db.patch(event._id, { status: "sent", sentAt: Date.now(), nextAttemptAt: undefined });
    return { found: true as const, updated: true };
  },
});
