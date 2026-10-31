import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { enqueueEvent } from "./automation/outbox";
import { audit } from "./lib/audit";
import { today } from "./lib/config";
import { appError } from "./lib/errors";
import { userMutation } from "./lib/functions";
import { loadLoanForParty, requireParty } from "./lib/loanAccess";
import { applyLoanTransition } from "./lib/loanTransitions";
import { enforceLimit } from "./lib/rateLimits";
import { blockingLoans } from "./lib/tools";
import { LIMITS } from "./lib/validators";
import { checkRequestedRange, type RangeProblem } from "./model/dates";
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
