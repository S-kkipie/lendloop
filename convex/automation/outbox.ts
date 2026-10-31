import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { EventType } from "../lib/validators";

// Stores IDs only. The payload (with the recipient's email) is built at send
// time by the delivery action (Plan 2), which also gets scheduled here.
export async function enqueueEvent(
  ctx: MutationCtx,
  event: { type: EventType; recipientId: Id<"users">; loanId?: Id<"loans">; toolId?: Id<"tools"> },
): Promise<Id<"outboxEvents">> {
  return await ctx.db.insert("outboxEvents", {
    ...event,
    schemaVersion: 1,
    status: "pending",
    attempts: 0,
  });
}
