import { rangesOverlap } from "@/convex/model/overlap";
import type { LoanStatus } from "@/lib/loanStatus";
import type { OverlapFacts } from "./LoanActions";

interface LoanLike {
  _id: string;
  status: LoanStatus;
  tool: { _id: string };
  startDate: string;
  endDate: string;
}

/**
 * For a pending request, from the owner's own loans: how many other pending
 * requests approving it would decline, and whether an approved or active loan
 * already holds some of its days (then the server refuses the approval).
 */
export function overlapFacts(loan: LoanLike, all: readonly LoanLike[]): OverlapFacts {
  let pending = 0;
  let booked = false;
  for (const other of all) {
    if (other._id === loan._id || other.tool._id !== loan.tool._id || !rangesOverlap(other, loan)) continue;
    if (other.status === "pending") pending += 1;
    if (other.status === "approved" || other.status === "active") booked = true;
  }
  return { pending, booked };
}
