import { v } from "convex/values";
import { audit } from "./lib/audit";
import { appError } from "./lib/errors";
import { displayName } from "./lib/displayName";
import { identityMutation, internalMutation, userQuery } from "./lib/functions";
import { applyLoanTransition } from "./lib/loanTransitions";
import { removeToolCascade } from "./lib/tools";

export const syncMe = identityMutation({
  args: {},
  handler: async (ctx) => {
    const { identity } = ctx;
    const composed = [identity.givenName, identity.familyName].filter(Boolean).join(" ");
    const name = (identity.name ?? composed).trim() || "Neighbour";
    const email = typeof identity.email === "string" ? identity.email : null;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.deletedAt !== undefined) throw appError("FORBIDDEN", "Account deleted");
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      name,
      email,
      isTrustedLender: false,
    });
  },
});

export const me = userQuery({
  args: {},
  handler: async (ctx) => ({
    id: ctx.user._id,
    displayName: displayName(ctx.user.name),
    email: ctx.user.email, // the viewer's own email only
    role: ctx.role,
    isTrustedLender: ctx.user.isTrustedLender,
  }),
});

export const applyClerkUpdate = internalMutation({
  args: { clerkId: v.string(), name: v.string(), email: v.union(v.string(), v.null()) },
  handler: async (ctx, { clerkId, name, email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    // Webhooks are unordered: never resurrect data for a deleted account.
    if (!user || user.deletedAt !== undefined) return;
    await ctx.db.patch(user._id, { name: name.trim() || user.name, email });
  },
});

export const deleteAccount = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user || user.deletedAt !== undefined) return { deleted: false };

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    for (const tool of tools.filter((t) => t.status === "listed")) {
      await removeToolCascade(ctx, { tool, actorType: "system", reason: "account_deleted", notifyOwner: false });
    }

    for (const status of ["pending", "approved"] as const) {
      const borrowed = await ctx.db
        .query("loans")
        .withIndex("by_borrower_status", (q) => q.eq("borrowerId", user._id).eq("status", status))
        .collect();
      for (const loan of borrowed) {
        await applyLoanTransition(ctx, {
          loan,
          action: "closeForAccountDeletion",
          actor: "system",
          actorType: "system",
          closeReason: "account_deleted",
          notify: [{ type: "loan.cancelled", recipientId: loan.ownerId }],
        });
      }
    }

    // Anonymize. Active loans stay so the other party can close them.
    await ctx.db.patch(user._id, {
      name: "Former neighbour",
      email: null,
      isTrustedLender: false,
      deletedAt: Date.now(),
    });
    await audit(ctx, { actorType: "system", action: "user.delete", entityType: "user", entityId: user._id });
    return { deleted: true };
  },
});
