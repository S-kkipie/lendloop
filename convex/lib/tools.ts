import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { enqueueEvent } from "../automation/outbox";
import { audit } from "./audit";
import { appError } from "./errors";
import { applyLoanTransition } from "./loanTransitions";
import { LIMITS } from "./validators";

export type Availability = { state: "available" } | { state: "on_loan"; until: string };

export async function activeLoanFor(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans"> | null> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "active"))
    .first();
}

export async function blockingLoans(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  const active = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "active"))
    .collect();
  return [...approved, ...active];
}

export function availabilityOf(active: Doc<"loans"> | null): Availability {
  return active ? { state: "on_loan", until: active.endDate } : { state: "available" };
}

export function cleanToolFields(input: { name: string; description: string }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (name.length < LIMITS.toolNameMin || name.length > LIMITS.toolNameMax) {
    throw appError("INVALID", `Name must be ${LIMITS.toolNameMin} to ${LIMITS.toolNameMax} characters`);
  }
  if (description.length > LIMITS.descriptionMax) {
    throw appError("INVALID", `Description must be at most ${LIMITS.descriptionMax} characters`);
  }
  return { name, description };
}

// Cancels open requests for the tool, hides it, audits, and notifies.
export async function removeToolCascade(
  ctx: MutationCtx,
  input: {
    tool: Doc<"tools">;
    actorId: Id<"users">;
    actorType: "user" | "admin";
    reason?: string;
    notifyOwner: boolean;
  },
): Promise<{ cancelledLoans: number }> {
  const { tool } = input;
  const open = [
    ...(await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
      .collect()),
    ...(await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
      .collect()),
  ];
  for (const loan of open) {
    await applyLoanTransition(ctx, {
      loan,
      action: "closeForListingRemoval",
      actor: "system",
      actorId: input.actorId,
      actorType: input.actorType,
      closeReason: "listing_removed",
      notify: [{ type: "listing.removed", recipientId: loan.borrowerId }],
    });
  }

  const now = Date.now();
  await ctx.db.patch(tool._id, {
    status: "removed",
    removedAt: now,
    removedBy: input.actorId,
    removalReason: input.reason,
    updatedAt: now,
  });
  await audit(ctx, {
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.actorType === "admin" ? "tool.moderate" : "tool.remove",
    entityType: "tool",
    entityId: tool._id,
    fromStatus: "listed",
    toStatus: "removed",
    reason: input.reason,
  });
  if (input.notifyOwner) {
    await enqueueEvent(ctx, { type: "listing.removed", recipientId: tool.ownerId, toolId: tool._id });
  }
  return { cancelledLoans: open.length };
}
