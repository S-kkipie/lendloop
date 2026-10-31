// Wire contract between Convex and n8n. Changing anything here is a breaking
// change for the exported n8n workflows; bump schemaVersion if payloads change.
import { v } from "convex/values";
import type { EventType } from "../lib/validators";
import type { LoanStatus } from "../model/loanMachine";

export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const EVENT_ID_HEADER = "x-lendloop-event-id";
export const SIGNATURE_WINDOW_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;
export const MIN_SECRET_LENGTH = 32;

// Only what the email needs. Never: last names, the counterpart's email,
// the borrower's message, tool descriptions, internal user IDs.
export interface NotificationPayloadV1 {
  schemaVersion: 1;
  eventId: string;
  type: EventType;
  occurredAt: string;
  recipient: { email: string; firstName: string };
  tool: { name: string };
  loan: { id: string; status: LoanStatus; startDate: string; endDate: string } | null;
  counterpartFirstName: string | null;
  actionUrl: string;
}

export const PAYLOAD_KEYS = {
  top: [
    "actionUrl",
    "counterpartFirstName",
    "eventId",
    "loan",
    "occurredAt",
    "recipient",
    "schemaVersion",
    "tool",
    "type",
  ],
  recipient: ["email", "firstName"],
  tool: ["name"],
  loan: ["endDate", "id", "startDate", "status"],
} as const;

export interface OverdueLoanV1 {
  loanId: string;
  idempotencyKey: string; // "<loanId>:<YYYY-MM-DD>"
  borrower: { email: string; firstName: string };
  tool: { name: string };
  endDate: string;
  daysOverdue: number;
}

export const vReminderReport = v.object({
  loanId: v.string(),
  idempotencyKey: v.string(),
  status: v.union(v.literal("sent"), v.literal("failed")),
  executionId: v.string(),
  error: v.optional(v.string()),
});

export const vNotificationStatus = v.object({
  eventId: v.string(),
  status: v.literal("sent"),
  executionId: v.string(),
});

export const vAutomationError = v.object({
  workflow: v.string(),
  executionId: v.string(),
  node: v.optional(v.string()),
  message: v.string(),
  eventId: v.optional(v.string()),
});
