import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { sign, signatureHeader } from "../lib/hmac";
import { appUrl, outboundConfig } from "../lib/integrationConfig";
import { log, sanitizeError } from "../lib/logger";
import { CLAIM_LEASE_MS, REQUEST_TIMEOUT_MS, classifyStatus, nextRetryDelay } from "../model/delivery";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";
import { buildNotificationPayload } from "./payloads";

const vEventId = { eventId: v.id("outboxEvents") };

export const claim = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || (event.status !== "pending" && event.status !== "retrying")) return null;
    const now = Date.now();
    if ((event.nextAttemptAt ?? 0) > now) return null; // another attempt holds the lease
    const attempts = event.attempts + 1;
    await ctx.db.patch(eventId, { attempts, nextAttemptAt: now + CLAIM_LEASE_MS });
    return { attempts };
  },
});

export const payloadFor = internalQuery({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    return event ? await buildNotificationPayload(ctx, event, appUrl()) : null;
  },
});

export const markDelivered = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    // Never downgrade: n8n may already have written back "sent", or reported a failure.
    if (!event || (event.status !== "pending" && event.status !== "retrying")) return;
    await ctx.db.patch(eventId, { status: "delivered", deliveredAt: Date.now(), nextAttemptAt: undefined });
  },
});

export const markSkipped = internalMutation({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    await ctx.db.patch(eventId, { status: "skipped", nextAttemptAt: undefined });
  },
});

export const markDead = internalMutation({
  args: { ...vEventId, error: v.string() },
  handler: async (ctx, { eventId, error }) => {
    await ctx.db.patch(eventId, { status: "dead", lastError: sanitizeError(error), nextAttemptAt: undefined });
    log.error("outbox.dead", { eventId, error });
  },
});

export const scheduleRetry = internalMutation({
  args: { ...vEventId, error: v.string() },
  handler: async (ctx, { eventId, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return;
    const delay = nextRetryDelay(event.attempts);
    if (delay === null) {
      await ctx.db.patch(eventId, { status: "dead", lastError: sanitizeError(error), nextAttemptAt: undefined });
      log.error("outbox.dead", { eventId, attempts: event.attempts, error });
      return;
    }
    await ctx.db.patch(eventId, {
      status: "retrying",
      lastError: sanitizeError(error),
      nextAttemptAt: Date.now() + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.automation.delivery.deliver, { eventId });
    log.warn("outbox.retry", { eventId, attempts: event.attempts, delayMs: delay });
  },
});

export const deliver = internalAction({
  args: vEventId,
  handler: async (ctx, { eventId }) => {
    const claimed = await ctx.runMutation(internal.automation.delivery.claim, { eventId });
    if (!claimed) return;

    const config = outboundConfig();
    if (!config.ok) {
      await ctx.runMutation(internal.automation.delivery.markDead, { eventId, error: config.error });
      return;
    }
    const payload = await ctx.runQuery(internal.automation.delivery.payloadFor, { eventId });
    if (!payload) {
      await ctx.runMutation(internal.automation.delivery.markSkipped, { eventId });
      return;
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(config.secret, timestamp, "POST", new URL(config.url).pathname, body);

    let outcome: "delivered" | "retry" | "dead";
    let error = "";
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signatureHeader(signature),
          [EVENT_ID_HEADER]: eventId,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      outcome = classifyStatus(response.status);
      error = `n8n responded ${response.status}`;
    } catch (caught) {
      outcome = "retry";
      error = sanitizeError(String(caught));
    }

    if (outcome === "delivered") {
      await ctx.runMutation(internal.automation.delivery.markDelivered, { eventId });
      log.info("outbox.delivered", { eventId, attempts: claimed.attempts });
    } else if (outcome === "retry") {
      await ctx.runMutation(internal.automation.delivery.scheduleRetry, { eventId, error });
    } else {
      await ctx.runMutation(internal.automation.delivery.markDead, { eventId, error });
    }
  },
});
