// HMAC-SHA256 request signing shared by both directions of the n8n integration.
import { SIGNATURE_WINDOW_SECONDS } from "../automation/contract";

const encoder = new TextEncoder();
const TIMESTAMP = /^\d{10}$/;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

export function canonicalString(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sign(secret: string, timestamp: string, method: string, path: string, body: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(canonicalString(timestamp, method, path, body)),
  );
  return toHex(signature);
}

export function signatureHeader(hex: string): string {
  return `v1=${hex}`;
}

export function parseSignatureHeader(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter((hex) => HEX_SIGNATURE.test(hex));
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export async function verifySignature(input: {
  secrets: string[];
  timestamp: string | null;
  signatureHeader: string | null;
  method: string;
  path: string;
  body: string;
  nowMs?: number;
  windowSeconds?: number;
}): Promise<VerifyResult> {
  const signatures = parseSignatureHeader(input.signatureHeader);
  if (!input.timestamp || !TIMESTAMP.test(input.timestamp) || signatures.length === 0) {
    return { ok: false, reason: "missing" };
  }
  const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - Number(input.timestamp)) > (input.windowSeconds ?? SIGNATURE_WINDOW_SECONDS)) {
    return { ok: false, reason: "stale" };
  }
  const data = encoder.encode(canonicalString(input.timestamp, input.method, input.path, input.body));
  for (const secret of input.secrets) {
    const key = await hmacKey(secret, "verify");
    for (const hex of signatures) {
      // crypto.subtle.verify compares in constant time.
      if (await crypto.subtle.verify("HMAC", key, fromHex(hex), data)) return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}
