import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../lib/functions";
import { verifySignature } from "../lib/hmac";
import { inboundSecrets } from "../lib/integrationConfig";
import { log } from "../lib/logger";
import { rateLimiter } from "../lib/rateLimits";
import { MAX_BODY_BYTES, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./contract";

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export class InvalidBody extends Error {}

// Every n8n → Convex endpoint goes through here, so none can skip a check.
// The signature is verified before the shared rate-limit bucket is touched:
// verifying is cheap, and unsigned junk must not be able to drain the bucket
// that n8n's real write-backs depend on. It still gets a bare 401.
export function signedEndpoint(handler: (ctx: ActionCtx, body: unknown) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const path = new URL(request.url).pathname;
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      return json(413, { error: "too_large" });
    }
    if (request.method === "POST" && !(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return json(415, { error: "unsupported_media_type" });
    }
    const raw = request.method === "GET" ? "" : await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "too_large" });

    const secrets = inboundSecrets();
    if (secrets.length === 0) {
      log.error("inbound.not_configured", { path });
      return json(503, { error: "not_configured" });
    }
    const verdict = await verifySignature({
      secrets,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      method: request.method,
      path,
      body: raw,
    });
    if (!verdict.ok) {
      log.warn("inbound.rejected", { path, reason: verdict.reason });
      return json(401, { error: "unauthorized" });
    }
    const { ok: withinLimit } = await rateLimiter.limit(ctx, "inboundHttp", { key: "n8n" });
    if (!withinLimit) return json(429, { error: "rate_limited" });

    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: "invalid_body" });
      }
    }
    try {
      return await handler(ctx, body);
    } catch (error) {
      if (error instanceof InvalidBody) return json(400, { error: "invalid_body" });
      log.error("inbound.failed", { path, error: String(error) });
      return json(500, { error: "internal" });
    }
  });
}
