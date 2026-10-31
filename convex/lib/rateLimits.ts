import { DAY, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  loanRequest: { kind: "token bucket", rate: 10, period: HOUR, capacity: 10 },
  toolCreate: { kind: "token bucket", rate: 20, period: DAY, capacity: 20 },
});

export type LimitName = "loanRequest" | "toolCreate";

export async function enforceLimit(ctx: MutationCtx, name: LimitName, key: string): Promise<void> {
  const { ok } = await rateLimiter.limit(ctx, name, { key });
  if (!ok) throw appError("RATE_LIMITED", "Too many attempts. Try again later.");
}
