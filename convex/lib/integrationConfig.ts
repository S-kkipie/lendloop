// The only place that reads integration environment variables.
import { MIN_SECRET_LENGTH } from "../automation/contract";

function secret(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.length >= MIN_SECRET_LENGTH ? value : null;
}

export function inboundSecrets(): string[] {
  return [secret("CONVEX_INBOUND_SECRET"), secret("CONVEX_INBOUND_SECRET_PREVIOUS")].filter(
    (value): value is string => value !== null,
  );
}

export type OutboundConfig = { ok: true; url: string; secret: string } | { ok: false; error: string };

export function outboundConfig(): OutboundConfig {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return { ok: false, error: "N8N_WEBHOOK_URL is not set" };
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "N8N_WEBHOOK_URL is not a valid URL" };
  }
  const current = secret("N8N_WEBHOOK_SECRET");
  if (!current) {
    return { ok: false, error: `N8N_WEBHOOK_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters` };
  }
  return { ok: true, url, secret: current };
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function clerkWebhookSecret(): string | null {
  const value = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  return value && value.startsWith("whsec_") ? value : null;
}
