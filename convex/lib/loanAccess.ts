import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { daysOverdue, isOverdue } from "../model/dates";
import { displayName } from "./displayName";
import { appError } from "./errors";
import type { ViewerCtx } from "./functions";

export type Party = "owner" | "borrower";

export async function loadLoanForParty(
  ctx: QueryCtx & ViewerCtx,
  loanId: Id<"loans">,
): Promise<{ loan: Doc<"loans">; party: Party }> {
  const loan = await ctx.db.get(loanId);
  if (loan?.ownerId === ctx.user._id) return { loan, party: "owner" };
  if (loan?.borrowerId === ctx.user._id) return { loan, party: "borrower" };
  throw appError("NOT_FOUND", "Request not found");
}

export function requireParty(party: Party, required: Party): void {
  if (party !== required) {
    throw appError("FORBIDDEN", required === "owner" ? "Only the tool owner can do this" : "Only the borrower can do this");
  }
}

export async function nameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const user = await ctx.db.get(userId);
  return user && user.deletedAt === undefined ? displayName(user.name) : "Former neighbour";
}

// What a loan looks like to a given viewer. The borrower's message is shown
// to the tool owner only.
export async function summarizeLoan(
  ctx: QueryCtx,
  loan: Doc<"loans">,
  today: string,
  viewer: Party | "admin",
) {
  const tool = await ctx.db.get(loan.toolId);
  const overdue = isOverdue(loan, today);
  return {
    _id: loan._id,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    closeReason: loan.closeReason,
    overdue,
    daysOverdue: overdue ? daysOverdue(loan.endDate, today) : 0,
    tool: { _id: loan.toolId, name: tool?.name ?? "Removed tool", category: tool?.category ?? "other" },
    owner: { displayName: await nameOf(ctx, loan.ownerId) },
    borrower: { displayName: await nameOf(ctx, loan.borrowerId) },
    message: viewer === "owner" ? loan.message : undefined,
  };
}
export type LoanSummary = Awaited<ReturnType<typeof summarizeLoan>>;
