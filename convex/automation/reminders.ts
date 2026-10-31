import { v } from "convex/values";
import { audit } from "../lib/audit";
import { today } from "../lib/config";
import { firstName } from "../lib/displayName";
import { internalMutation, internalQuery } from "../lib/functions";
import { sanitizeError } from "../lib/logger";
import { daysOverdue } from "../model/dates";
import type { OverdueLoanV1 } from "./contract";

export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx): Promise<OverdueLoanV1[]> => {
    const t0 = today();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "active").lt("endDate", t0))
      .take(200);
    const rows: OverdueLoanV1[] = [];
    for (const loan of loans) {
      const idempotencyKey = `${loan._id}:${t0}`;
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing?.status === "sent") continue; // already reminded today
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower || borrower.deletedAt !== undefined || !borrower.email) continue;
      const tool = await ctx.db.get(loan.toolId);
      rows.push({
        loanId: loan._id,
        idempotencyKey,
        borrower: { email: borrower.email, firstName: firstName(borrower.name) },
        tool: { name: tool?.name ?? "a tool" },
        endDate: loan.endDate,
        daysOverdue: daysOverdue(loan.endDate, t0),
      });
    }
    return rows;
  },
});

export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    executionId: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    // Don't trust n8n blindly: the key must be today's key for a real loan
    // that was out on loan (it may have been returned since the fetch).
    if (
      !loan ||
      args.idempotencyKey !== `${loan._id}:${today()}` ||
      (loan.status !== "active" && loan.status !== "returned")
    ) {
      return { accepted: false as const };
    }
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", n8nExecutionId: args.executionId, error: undefined });
        return { accepted: true as const, duplicate: false };
      }
      return { accepted: true as const, duplicate: true };
    }
    await ctx.db.insert("reminders", {
      loanId: loan._id,
      idempotencyKey: args.idempotencyKey,
      status: args.status,
      n8nExecutionId: args.executionId,
      error: args.error ? sanitizeError(args.error) : undefined,
    });
    await audit(ctx, {
      actorType: "n8n",
      action: `reminder.${args.status}`,
      entityType: "loan",
      entityId: loan._id,
    });
    return { accepted: true as const, duplicate: false };
  },
});
