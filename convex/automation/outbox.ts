import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { EventType } from "../lib/validators";

// Stores IDs only. Scheduling from a mutation is atomic with its commit: if
// the state change rolls back, the event and its delivery never exist.
export async function enqueueEvent(
  ctx: MutationCtx,
  event: {
    type: EventType;
    recipientId: Id<"users">;
    loanId?: Id<"loans">;
    toolId?: Id<"tools">;
    replayOf?: Id<"outboxEvents">;
  },
): Promise<Id<"outboxEvents">> {
  const eventId = await ctx.db.insert("outboxEvents", {
    ...event,
    schemaVersion: 1,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.automation.delivery.deliver, { eventId });
  return eventId;
}
