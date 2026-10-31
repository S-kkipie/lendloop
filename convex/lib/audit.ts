import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ActorType, EntityType } from "./validators";

// Append-only: there is intentionally no update or delete helper for auditLog.
export async function audit(
  ctx: MutationCtx,
  entry: {
    actorId?: Id<"users">;
    actorType: ActorType;
    action: string;
    entityType: EntityType;
    entityId: string;
    fromStatus?: string;
    toStatus?: string;
    reason?: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
