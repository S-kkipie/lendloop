import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { enqueueEvent } from "./automation/outbox";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { appError } from "./lib/errors";
import { userMutation, userQuery } from "./lib/functions";
import { loadLoanForParty, nameOf, requireParty, summarizeLoan } from "./lib/loanAccess";
import { applyLoanTransition } from "./lib/loanTransitions";
import { enforceLimit } from "./lib/rateLimits";
import { activeLoanFor, blockingLoans } from "./lib/tools";
import { LIMITS } from "./lib/validators";
import { checkRequestedRange, type RangeProblem } from "./model/dates";
import { nextStep } from "./model/loanMachine";
import { rangesOverlap } from "./model/overlap";

const RANGE_MESSAGES: Record<RangeProblem, string> = {
  invalid_format: "Dates must look like 2026-11-05",
  end_before_start: "The end date must be on or after the start date",
  starts_in_past: "The start date can't be in the past",
  too_long: `Loans can be at most ${LIMITS.maxLoanDays} days`,
};

async function pendingOverlapping(ctx: MutationCtx, loan: Doc<"loans">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
    .collect();
  return pending.filter((other) => other._id !== loan._id && rangesOverlap(other, loan));
}

export const request = userMutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "Tool not found");
    if (tool.ownerId === ctx.user._id) throw appError("INVALID", "You can't borrow your own tool");

    const problem = checkRequestedRange(args.startDate, args.endDate, today(), LIMITS.maxLoanDays);
    if (problem) throw appError("INVALID", RANGE_MESSAGES[problem]);

    const message = args.message?.trim() || undefined;
    if (message && message.length > LIMITS.messageMax) {
      throw appError("INVALID", `Message must be at most ${LIMITS.messageMax} characters`);
    }

    await enforceLimit(ctx, "loanRequest", ctx.user._id);

    const range = { startDate: args.startDate, endDate: args.endDate };
    if ((await blockingLoans(ctx, tool._id)).some((loan) => rangesOverlap(loan, range))) {
      throw appError("CONFLICT", "Those dates are already booked");
    }
    const alreadyPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) => q.eq("borrowerId", ctx.user._id).eq("status", "pending"))
      .filter((q) => q.eq(q.field("toolId"), tool._id))
      .first();
    if (alreadyPending) throw appError("CONFLICT", "You already have a pending request for this tool");

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: ctx.user._id,
      startDate: args.startDate,
      endDate: args.endDate,
      message,
      status: "pending",
    });
    await audit(ctx, {
      actorId: ctx.user._id,
      actorType: "user",
      action: "loan.request",
      entityType: "loan",
      entityId: loanId,
      toStatus: "pending",
    });
    await enqueueEvent(ctx, { type: "loan.requested", recipientId: tool.ownerId, loanId, toolId: tool._id });
    return loanId;
  },
});

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    if (loan.status === "pending" && loan.startDate < today()) {
      throw appError("INVALID", "This request's start date has passed");
    }
    const clash = (await blockingLoans(ctx, loan.toolId)).some(
      (other) => other._id !== loan._id && rangesOverlap(other, loan),
    );
    if (clash) throw appError("CONFLICT", "Those dates are already booked");

    await applyLoanTransition(ctx, {
      loan,
      action: "approve",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.approved", recipientId: loan.borrowerId }],
    });

    const overlapping = await pendingOverlapping(ctx, loan);
    for (const other of overlapping) {
      await applyLoanTransition(ctx, {
        loan: other,
        action: "decline",
        actor: "system",
        actorType: "system",
        closeReason: "dates_taken",
        notify: [{ type: "loan.declined", recipientId: other.borrowerId }],
      });
    }
    return { autoDeclined: overlapping.length };
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    await applyLoanTransition(ctx, {
      loan,
      action: "decline",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      closeReason: "owner_declined",
      notify: [{ type: "loan.declined", recipientId: loan.borrowerId }],
    });
    return null;
  },
});

export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    const counterpart = party === "owner" ? loan.borrowerId : loan.ownerId;
    await applyLoanTransition(ctx, {
      loan,
      action: "cancel",
      actor: party,
      actorId: ctx.user._id,
      actorType: "user",
      closeReason: party === "owner" ? "owner_cancelled" : "borrower_cancelled",
      notify: [{ type: "loan.cancelled", recipientId: counterpart }],
    });
    return null;
  },
});

export const handOver = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner");
    if (loan.status === "approved" && today() > loan.endDate) {
      throw appError("INVALID", "This booking has already ended");
    }
    const active = await activeLoanFor(ctx, loan.toolId);
    if (active && active._id !== loan._id) {
      throw appError("CONFLICT", "This tool is still out on another loan");
    }
    await applyLoanTransition(ctx, {
      loan,
      action: "handOver",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.handed_over", recipientId: loan.borrowerId }],
    });
    return null;
  },
});

export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan, party } = await loadLoanForParty(ctx, loanId);
    requireParty(party, "owner"); // the owner confirms they got it back
    await applyLoanTransition(ctx, {
      loan,
      action: "markReturned",
      actor: "owner",
      actorId: ctx.user._id,
      actorType: "user",
      notify: [{ type: "loan.returned", recipientId: loan.borrowerId }],
    });
    return null;
  },
});

export const myRequests = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) => q.eq("borrowerId", ctx.user._id))
      .take(200);
    const t0 = today();
    const sorted = loans.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(sorted.map((loan) => summarizeLoan(ctx, loan, t0, "borrower")));
  },
});

export const incoming = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ctx.user._id))
      .take(200);
    const t0 = today();
    const sorted = loans.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      sorted.map(async (loan) => {
        const conflicts =
          loan.status === "pending"
            ? loans.filter(
                (other) =>
                  other._id !== loan._id &&
                  other.toolId === loan.toolId &&
                  (other.status === "pending" || other.status === "approved") &&
                  rangesOverlap(other, loan),
              ).length
            : 0;
        return { ...(await summarizeLoan(ctx, loan, t0, "owner")), conflicts };
      }),
    );
  },
});

export const timeline = userQuery({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get(loanId);
    const party = loan?.ownerId === ctx.user._id ? "owner" : loan?.borrowerId === ctx.user._id ? "borrower" : null;
    const isAdmin = ctx.role === "admin";
    if (!loan || (!party && !isAdmin)) throw appError("NOT_FOUND", "Request not found");

    const audits = await ctx.db
      .query("auditLog")
      .withIndex("by_entity", (q) => q.eq("entityType", "loan").eq("entityId", loanId))
      .collect();
    const events = await ctx.db
      .query("outboxEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect();
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect();

    const names = new Map<Id<"users">, string>();
    const actorName = async (id: Id<"users"> | undefined) => {
      if (!id) return "LendLoop";
      if (!names.has(id)) names.set(id, await nameOf(ctx, id));
      return names.get(id)!;
    };

    const statusEntries = await Promise.all(
      audits.map(async (a) => ({
        kind: "status" as const,
        at: a.at,
        action: a.action,
        toStatus: a.toStatus,
        reason: a.reason,
        actor: a.actorType === "system" ? "LendLoop" : await actorName(a.actorId),
      })),
    );
    const notificationEntries = events.map((e) => ({
      kind: "notification" as const,
      at: e.sentAt ?? e.deliveredAt ?? e._creationTime,
      type: e.type,
      status: e.status,
      recipient: e.recipientId === loan.ownerId ? ("owner" as const) : ("borrower" as const),
      error: isAdmin ? e.lastError : undefined,
    }));
    const reminderEntries = reminders.map((r) => ({
      kind: "reminder" as const,
      at: r._creationTime,
      status: r.status,
    }));

    return {
      loan: await summarizeLoan(ctx, loan, today(), party ?? "admin"),
      nextStep: nextStep(loan.status),
      entries: [...statusEntries, ...notificationEntries, ...reminderEntries].sort((a, b) => a.at - b.at),
    };
  },
});
