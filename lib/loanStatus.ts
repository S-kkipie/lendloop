import type { Icon } from "@phosphor-icons/react";
import {
  ArrowUUpLeftIcon,
  CheckIcon,
  ClockIcon,
  HandshakeIcon,
  HourglassSimpleLowIcon,
  ProhibitIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import type { CloseReason } from "../convex/lib/validators";
import type { LoanStatus } from "../convex/model/loanMachine";

export type { CloseReason, LoanStatus };

/** Semantic tone of a status; "danger" is reserved for overdue loans. */
export type StatusTone = "neutral" | "accent" | "info" | "ok" | "closed" | "danger";

/** Badge variant (components/ui/badge) for each tone. */
export const BADGE_VARIANT_BY_TONE = {
  neutral: "neutral",
  accent: "default",
  info: "info",
  ok: "ok",
  closed: "outline",
  danger: "danger",
} as const satisfies Record<StatusTone, string>;

export interface StatusView {
  label: string;
  tone: StatusTone;
  icon: Icon;
}

const STATUS_VIEWS: Record<LoanStatus, StatusView> = {
  pending: { label: "Requested", tone: "neutral", icon: ClockIcon },
  approved: { label: "Approved", tone: "accent", icon: CheckIcon },
  active: { label: "Handed over", tone: "info", icon: HandshakeIcon },
  returned: { label: "Returned", tone: "ok", icon: ArrowUUpLeftIcon },
  declined: { label: "Declined", tone: "closed", icon: XIcon },
  cancelled: { label: "Cancelled", tone: "closed", icon: ProhibitIcon },
  expired: { label: "Expired", tone: "closed", icon: HourglassSimpleLowIcon },
};

export function loanStatusView(loan: {
  status: LoanStatus;
  overdue: boolean;
  daysOverdue: number;
  closeReason?: CloseReason;
}): StatusView {
  if (loan.overdue) {
    const days = loan.daysOverdue;
    const label = days > 0 ? `Overdue ${days} ${days === 1 ? "day" : "days"}` : "Overdue";
    return { label, tone: "danger", icon: WarningIcon };
  }
  return STATUS_VIEWS[loan.status];
}

const CLOSE_REASON_TEXT: Record<CloseReason, string> = {
  owner_declined: "The owner declined",
  dates_taken: "Dates were taken by another booking",
  listing_removed: "Listing was removed",
  borrower_cancelled: "Cancelled by the borrower",
  owner_cancelled: "Cancelled by the owner",
  account_deleted: "The account was deleted",
  not_handed_over: "Not handed over before the end date",
  start_passed: "Start date passed before approval",
};

/** Why a loan closed, for timelines and detail views. */
export function closeReasonText(reason: CloseReason | undefined): string | null {
  return reason ? CLOSE_REASON_TEXT[reason] : null;
}

export type LoanAction = "approve" | "decline" | "handOver" | "markReturned" | "cancel";

const NEXT_ACTIONS: Record<"owner" | "borrower", Partial<Record<LoanStatus, readonly LoanAction[]>>> = {
  owner: {
    pending: ["approve", "decline"],
    approved: ["handOver", "cancel"],
    active: ["markReturned"],
  },
  borrower: {
    pending: ["cancel"],
    approved: ["cancel"],
  },
};

/** Buttons to show a party for a loan, mirroring the server state machine. */
export function nextActionsFor(viewer: "owner" | "borrower", status: LoanStatus): LoanAction[] {
  return [...(NEXT_ACTIONS[viewer][status] ?? [])];
}
