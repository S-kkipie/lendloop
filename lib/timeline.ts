// Copy for the loan timeline (/loans/[id]): what each entry from
// loans.timeline says to the person looking at it. Pure, so it is tested.
import type { CloseReason, EventType, OutboxStatus } from "../convex/lib/validators";
import type { LoanStatus, NextStep } from "../convex/model/loanMachine";
import { firstName, formatDay, inSentence } from "./format";

export type TimelineViewer = "owner" | "borrower" | "admin";

export interface TimelineContext {
  viewer: TimelineViewer;
  /** Display names ("Marta R.", "Ana L."). */
  owner: string;
  borrower: string;
  toolName: string;
  /** Last day of the loan, "YYYY-MM-DD". */
  endDate: string;
}

export interface StatusEntry {
  kind: "status";
  action: string;
  toStatus?: string;
  reason?: string;
  actor: string;
}

export interface NotificationEntry {
  kind: "notification";
  type: EventType;
  status: OutboxStatus;
  recipient: "owner" | "borrower";
}

export interface ReminderEntry {
  kind: "reminder";
  status: "sent" | "failed";
}

export interface EntryCopy {
  title: string;
  detail?: string;
  /** Something went wrong (shown in danger ink, with the reason for admins). */
  failed?: boolean;
}

const STATUS_LABEL: Record<LoanStatus, string> = {
  pending: "Requested",
  approved: "Approved",
  active: "Handed over",
  returned: "Returned",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Which party took a user action; system actions have none. */
function actingParty(entry: StatusEntry): "owner" | "borrower" | null {
  switch (entry.action) {
    case "loan.request":
      return "borrower";
    case "loan.approve":
    case "loan.handOver":
    case "loan.markReturned":
      return "owner";
    case "loan.decline":
      return entry.reason === "dates_taken" ? null : "owner";
    case "loan.cancel":
      return entry.reason === "owner_cancelled" ? "owner" : "borrower";
    default:
      return null;
  }
}

/** "you" when the viewer did it, else the actor's display name. */
function who(entry: StatusEntry, ctx: TimelineContext): string {
  const party = actingParty(entry);
  return party !== null && party === ctx.viewer ? "you" : entry.actor;
}

/**
 * Audit rows that the timeline already shows another way: a reminder is
 * audited on the loan ("reminder.sent") and also has its own reminder entry.
 */
export function isShownAsAutomation(entry: StatusEntry): boolean {
  return entry.action.startsWith("reminder.");
}

/** "Requested by Ana L.", "Approved by you", "Declined: dates taken", "Handed over". */
export function statusEntryCopy(entry: StatusEntry, ctx: TimelineContext): EntryCopy {
  const reason = entry.reason as CloseReason | undefined;
  switch (entry.action) {
    case "loan.request":
      return { title: `Requested by ${who(entry, ctx)}` };
    case "loan.approve":
      return { title: `Approved by ${who(entry, ctx)}` };
    case "loan.decline":
      return reason === "dates_taken"
        ? { title: "Declined: dates taken", detail: "Another request for these days was approved." }
        : { title: `Declined by ${who(entry, ctx)}` };
    case "loan.cancel":
      return { title: `Cancelled by ${who(entry, ctx)}` };
    case "loan.handOver":
      return { title: "Handed over", detail: `Due back ${formatDay(ctx.endDate)}.` };
    case "loan.markReturned":
      return { title: "Returned", detail: `${who(entry, ctx) === "you" ? "You" : entry.actor} confirmed it's back.` };
    case "loan.expire":
      return reason === "not_handed_over"
        ? { title: "Expired: not handed over in time" }
        : { title: "Expired: start date passed", detail: "Nobody answered before the first day." };
    case "loan.closeForListingRemoval":
      return { title: "Cancelled: listing removed" };
    case "loan.closeForAccountDeletion":
      return { title: "Cancelled: account deleted" };
    default: {
      const label = entry.toStatus ? STATUS_LABEL[entry.toStatus as LoanStatus] : undefined;
      return { title: label ?? "Updated" };
    }
  }
}

const EMAIL_SUBJECT: Record<EventType, string> = {
  "loan.requested": "New request",
  "loan.approved": "Request approved",
  "loan.declined": "Request declined",
  "loan.cancelled": "Booking cancelled",
  "loan.handed_over": "Handover confirmed",
  "loan.returned": "Return confirmed",
  "loan.expired": "Request expired",
  "listing.removed": "Listing removed",
};

const EMAIL_STATE: Record<OutboxStatus, { verb: string; failed?: boolean }> = {
  pending: { verb: "queued" },
  delivered: { verb: "queued" },
  sent: { verb: "sent" },
  retrying: { verb: "failed, retrying", failed: true },
  failed: { verb: "failed", failed: true },
  dead: { verb: "failed", failed: true },
  skipped: { verb: "not sent" },
};

function recipientName(party: "owner" | "borrower", ctx: TimelineContext): string {
  return party === ctx.viewer ? "you" : firstName(party === "owner" ? ctx.owner : ctx.borrower);
}

/** "Email to Marta queued", "Email to you sent", "Email to you failed, retrying". */
export function notificationEntryCopy(entry: NotificationEntry, ctx: TimelineContext): EntryCopy {
  const state = EMAIL_STATE[entry.status];
  return {
    title: `Email to ${recipientName(entry.recipient, ctx)} ${state.verb}`,
    detail: EMAIL_SUBJECT[entry.type],
    failed: state.failed,
  };
}

/** "Reminder sent to Ana" / "Reminder sent to you" / "Reminder failed". Reminders go to the borrower. */
export function reminderEntryCopy(entry: ReminderEntry, ctx: TimelineContext): EntryCopy {
  return entry.status === "sent"
    ? { title: `Reminder sent to ${recipientName("borrower", ctx)}`, detail: "Overdue reminder by email" }
    : { title: "Reminder failed", detail: "Overdue reminder by email", failed: true };
}

/** The dashed "what happens next" entry, or null once the loan is closed. */
export function nextStepCopy(
  step: NextStep,
  loan: { startDate: string; endDate: string; overdue: boolean },
  ctx: TimelineContext,
): EntryCopy | null {
  const owner = ctx.viewer === "owner" ? "You" : firstName(ctx.owner);
  const borrower = ctx.viewer === "borrower" ? "You" : firstName(ctx.borrower);
  const tool = inSentence(ctx.toolName);
  switch (step) {
    case "owner_decision":
      return {
        title: `${owner} ${ctx.viewer === "owner" ? "approve or decline" : "approves or declines"}`,
        detail: `By ${formatDay(loan.startDate)}, or the request expires.`,
      };
    case "handover":
      return {
        title: `${owner} ${ctx.viewer === "owner" ? "confirm" : "confirms"} the handover`,
        detail: `The booking starts ${formatDay(loan.startDate)}.`,
      };
    case "return":
      return {
        title: `${borrower} ${ctx.viewer === "borrower" ? "return" : "returns"} the ${tool} by ${formatDay(loan.endDate)}`,
        detail: loan.overdue
          ? `It's late. ${owner} ${ctx.viewer === "owner" ? "mark" : "marks"} it returned once it's back.`
          : `${owner} ${ctx.viewer === "owner" ? "mark" : "marks"} it returned once it's back.`,
      };
    default:
      return null;
  }
}
