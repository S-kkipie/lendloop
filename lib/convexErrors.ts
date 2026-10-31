import { ConvexError } from "convex/values";
import type { ErrorCode } from "../convex/lib/errors";

export type { ErrorCode };

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID",
  "RATE_LIMITED",
]);

const FALLBACK = "Something went wrong. Please try again.";

// Codes whose server message is generic or internal get fixed copy. INVALID and
// CONFLICT messages are written for users (validation and overlap details).
const FIXED_COPY: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You can't do that.",
  NOT_FOUND: "This item no longer exists.",
  RATE_LIMITED: "Too many attempts. Try again in a few minutes.",
};

function errorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

/** The typed error code from a ConvexError({ code, message }), or null. */
export function errorCode(error: unknown): ErrorCode | null {
  const code = errorData(error)?.code;
  return typeof code === "string" && CODES.has(code) ? (code as ErrorCode) : null;
}

/** A sentence to show the user for any thrown value. */
export function messageForError(error: unknown): string {
  const code = errorCode(error);
  if (!code) return FALLBACK;
  const fixed = FIXED_COPY[code];
  if (fixed) return fixed;
  const message = errorData(error)?.message;
  return typeof message === "string" && message.trim() ? message.trim() : FALLBACK;
}

/**
 * True when the thing asked for doesn't exist for this viewer: a NOT_FOUND
 * from our functions, or an id Convex rejects before the function runs (a
 * mistyped or truncated link, e.g. /tools/abc).
 */
export function isNotFound(error: unknown): boolean {
  if (errorCode(error) === "NOT_FOUND") return true;
  return error instanceof Error && /ArgumentValidationError|does not match validator/.test(error.message);
}
