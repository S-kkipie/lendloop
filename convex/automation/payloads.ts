import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { firstName } from "../lib/displayName";
import type { NotificationPayloadV1 } from "./contract";

// Built at send time (never stored), so a deleted recipient never leaks.
export async function buildNotificationPayload(
  ctx: QueryCtx,
  event: Doc<"outboxEvents">,
  appUrl: string,
): Promise<NotificationPayloadV1 | null> {
  const recipient = await ctx.db.get(event.recipientId);
  if (!recipient || recipient.deletedAt !== undefined || !recipient.email) return null;

  const loan = event.loanId ? await ctx.db.get(event.loanId) : null;
  const toolId = event.toolId ?? loan?.toolId;
  const tool = toolId ? await ctx.db.get(toolId) : null;

  let counterpartFirstName: string | null = null;
  if (loan) {
    const otherId = loan.ownerId === recipient._id ? loan.borrowerId : loan.ownerId;
    const other = await ctx.db.get(otherId);
    counterpartFirstName = other && other.deletedAt === undefined ? firstName(other.name) : null;
  }

  return {
    schemaVersion: 1,
    eventId: event._id,
    type: event.type,
    occurredAt: new Date(event._creationTime).toISOString(),
    recipient: { email: recipient.email, firstName: firstName(recipient.name) },
    tool: { name: tool?.name ?? "a tool" },
    loan: loan ? { id: loan._id, status: loan.status, startDate: loan.startDate, endDate: loan.endDate } : null,
    counterpartFirstName,
    actionUrl: loan ? `${appUrl}/loans/${loan._id}` : `${appUrl}/me/listings`,
  };
}
