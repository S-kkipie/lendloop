import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
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
