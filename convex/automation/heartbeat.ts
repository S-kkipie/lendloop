import { internalMutation } from "../lib/functions";
import { log } from "../lib/logger";
import { isStale } from "../model/heartbeat";

export const REMINDER_WORKFLOW = "overdue-reminders" as const;

export const checkIn = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastCheckInAt: Date.now() });
    else await ctx.db.insert("automationHeartbeats", { workflow: REMINDER_WORKFLOW, lastCheckInAt: Date.now() });
  },
});

// Hourly dead-man's switch: the error workflow can't report a cron that never ran.
export const checkStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const beat = await ctx.db
      .query("automationHeartbeats")
      .withIndex("by_workflow", (q) => q.eq("workflow", REMINDER_WORKFLOW))
      .unique();
    const stale = isStale(beat?.lastCheckInAt ?? null, Date.now());
    if (stale) log.warn("heartbeat.stale", { workflow: REMINDER_WORKFLOW, lastCheckInAt: beat?.lastCheckInAt ?? null });
    return { stale };
  },
});
