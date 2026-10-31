// Pure delivery rules for outbox events sent to n8n.
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const REQUEST_TIMEOUT_MS = 10_000;
export const CLAIM_LEASE_MS = 60_000;

export type DeliveryOutcome = "delivered" | "retry" | "dead";

export function classifyStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "dead"; // other 4xx: configuration problem, retrying will not help
}

// attemptsMade counts the attempt that just failed.
export function nextRetryDelay(attemptsMade: number): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[attemptsMade - 1] ?? null;
}
