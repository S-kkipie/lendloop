import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueEvent } from "../automation/outbox";
import { isTerminal, nextStatus, type LoanAction, type LoanActor, type LoanStatus } from "../model/loanMachine";
import { audit } from "./audit";
import { appError } from "./errors";
import type { ActorType, CloseReason, EventType } from "./validators";

export type Notify = { type: EventType; recipientId: Id<"users"> };

// The only way a loan changes status: validate, patch, audit and enqueue
// notifications in the caller's transaction.
export async function applyLoanTransition(
  ctx: MutationCtx,
  input: {
    loan: Doc<"loans">;
    action: LoanAction;
    actor: LoanActor;
    actorId?: Id<"users">;
    actorType: ActorType;
    closeReason?: CloseReason;
    notify: Notify[];
  },
): Promise<LoanStatus> {
  const { loan } = input;
  const to = nextStatus(loan.status, input.action, input.actor);
  if (to === null) {
    throw appError("CONFLICT", `This request is ${loan.status} and can't be changed that way`);
  }

  const now = Date.now();
  const patch: Partial<Doc<"loans">> = { status: to };
  if (to === "approved") patch.approvedAt = now;
  if (to === "active") patch.handedOverAt = now;
  if (to === "returned") patch.returnedAt = now;
  if (isTerminal(to)) {
    patch.closedAt = now;
    if (input.closeReason) patch.closeReason = input.closeReason;
  }
  await ctx.db.patch(loan._id, patch);

  await audit(ctx, {
    actorId: input.actorId,
    actorType: input.actorType,
    action: `loan.${input.action}`,
    entityType: "loan",
    entityId: loan._id,
    fromStatus: loan.status,
    toStatus: to,
    reason: input.closeReason,
  });

  for (const n of input.notify) {
    await enqueueEvent(ctx, { type: n.type, recipientId: n.recipientId, loanId: loan._id, toolId: loan.toolId });
  }
  return to;
}
