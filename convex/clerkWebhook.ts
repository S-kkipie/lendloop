import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { MAX_BODY_BYTES } from "./automation/contract";
import { json } from "./automation/inbound";
import { httpAction } from "./lib/functions";
import { clerkWebhookSecret } from "./lib/integrationConfig";
import { log } from "./lib/logger";
import { rateLimiter } from "./lib/rateLimits";

type ClerkEmail = { id: string; email_address: string };
type UserUpdated = {
  type: "user.updated";
  data: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    primary_email_address_id: string | null;
    email_addresses: ClerkEmail[];
  };
};
type UserDeleted = { type: "user.deleted"; data: { id?: string; deleted?: boolean } };
type ClerkEvent = UserUpdated | UserDeleted | { type: string; data: unknown };

// Svix-verified Clerk events. Delivery is at-least-once and unordered, so the
// handlers are idempotent and never resurrect a deleted account.
export const clerkWebhook = httpAction(async (ctx, request) => {
  const { ok } = await rateLimiter.limit(ctx, "clerkWebhook", { key: "clerk" });
  if (!ok) return json(429, { error: "rate_limited" });
  const secret = clerkWebhookSecret();
  if (!secret) return json(503, { error: "not_configured" });

  const payload = await request.text();
  if (new TextEncoder().encode(payload).length > MAX_BODY_BYTES) return json(413, { error: "too_large" });

  try {
    // svix 2.9 throws on a bad signature or timestamp and returns nothing.
    new Webhook(secret).verify(payload, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    });
  } catch {
    log.warn("clerk_webhook.rejected", {});
    return json(401, { error: "unauthorized" });
  }
  let event: ClerkEvent;
  try {
    event = JSON.parse(payload) as ClerkEvent;
  } catch {
    return json(400, { error: "invalid_body" });
  }

  if (event.type === "user.updated") {
    const { data } = event as UserUpdated;
    const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
    await ctx.runMutation(internal.users.applyClerkUpdate, {
      clerkId: data.id,
      name: [data.first_name, data.last_name].filter(Boolean).join(" "),
      email: primary?.email_address ?? null,
    });
  } else if (event.type === "user.deleted") {
    const { data } = event as UserDeleted;
    if (data.id) await ctx.runMutation(internal.users.deleteAccount, { clerkId: data.id });
  }
  return json(200, { ok: true });
});
