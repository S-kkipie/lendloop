export const HEARTBEAT_MAX_AGE_MS = 26 * 3_600_000; // daily cron plus slack

export function isStale(lastCheckInAt: number | null, now: number, maxAgeMs = HEARTBEAT_MAX_AGE_MS): boolean {
  return lastCheckInAt === null || now - lastCheckInAt > maxAgeMs;
}
