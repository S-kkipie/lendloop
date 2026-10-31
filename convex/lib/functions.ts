// The only file allowed to import raw function builders. Every public Convex
// function is built from these wrappers so authentication and roles are
// resolved the same way everywhere.
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { UserIdentity } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";

export type Role = "admin" | "user";
export type ViewerCtx = { user: Doc<"users">; role: Role };

export function parseRole(claim: unknown): Role {
  return claim === "admin" ? "admin" : "user";
}

async function requireIdentity(ctx: QueryCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Sign in required");
  return identity;
}

async function loadViewer(ctx: QueryCtx): Promise<ViewerCtx> {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user || user.deletedAt !== undefined) {
    throw appError("UNAUTHENTICATED", "Account not ready");
  }
  return { user, role: parseRole(identity.role) };
}

async function loadAdmin(ctx: QueryCtx): Promise<ViewerCtx> {
  const viewer = await loadViewer(ctx);
  if (viewer.role !== "admin") throw appError("FORBIDDEN", "Admins only");
  return viewer;
}

// Allowlisted: used only by tools.listPublic (enforced by tests/static/wrappers.test.ts).
export const publicQuery = query;

// Used only by users.syncMe, which must run before the users row exists.
export const identityMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ identity: await requireIdentity(ctx) })),
);

export const userQuery = customQuery(query, customCtx(async (ctx) => loadViewer(ctx)));
export const userMutation = customMutation(mutation, customCtx(async (ctx) => loadViewer(ctx)));
export const adminQuery = customQuery(query, customCtx(async (ctx) => loadAdmin(ctx)));
export const adminMutation = customMutation(mutation, customCtx(async (ctx) => loadAdmin(ctx)));

export { httpAction, internalAction, internalMutation, internalQuery };
