import { appError } from "./lib/errors";
import { displayName } from "./lib/displayName";
import { identityMutation, userQuery } from "./lib/functions";

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
