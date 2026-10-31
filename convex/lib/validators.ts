import { type Infer } from "convex/values";
import { literals } from "convex-helpers/validators";
import { LOAN_STATUSES } from "../model/loanMachine";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders",
  "other",
] as const;
export const CONDITIONS = ["new", "like_new", "good", "fair"] as const;
export const CLOSE_REASONS = [
  "owner_declined",
  "dates_taken",
  "listing_removed",
  "borrower_cancelled",
  "owner_cancelled",
  "account_deleted",
  "not_handed_over",
  "start_passed",
] as const;
export const EVENT_TYPES = [
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.handed_over",
  "loan.returned",
  "loan.expired",
  "listing.removed",
] as const;
export const OUTBOX_STATUSES = [
  "pending",
  "retrying",
  "delivered",
  "sent",
  "failed",
  "dead",
  "skipped",
] as const;

export const vCategory = literals(...CATEGORIES);
export const vCondition = literals(...CONDITIONS);
export const vLoanStatus = literals(...LOAN_STATUSES);
export const vCloseReason = literals(...CLOSE_REASONS);
export const vEventType = literals(...EVENT_TYPES);
export const vOutboxStatus = literals(...OUTBOX_STATUSES);
export const vActorType = literals("user", "admin", "system", "n8n");
export const vEntityType = literals("loan", "tool", "user", "outboxEvent", "automationError");
export const vToolStatus = literals("listed", "removed");

export type Category = Infer<typeof vCategory>;
export type Condition = Infer<typeof vCondition>;
export type CloseReason = Infer<typeof vCloseReason>;
export type EventType = Infer<typeof vEventType>;
export type OutboxStatus = Infer<typeof vOutboxStatus>;
export type ActorType = Infer<typeof vActorType>;
export type EntityType = Infer<typeof vEntityType>;

export const LIMITS = {
  toolNameMin: 3,
  toolNameMax: 60,
  descriptionMax: 500,
  messageMax: 300,
  removalReasonMin: 3,
  removalReasonMax: 200,
  maxLoanDays: 30,
} as const;
