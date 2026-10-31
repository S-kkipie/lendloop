// Admin console (/admin): URL state, labels and the copy that explains the
// automation. Pure, so it is tested. Delivery and heartbeat numbers come from
// the Convex rules themselves, so the explanation can never drift from them.
import type { EntityType, EventType, OutboxStatus } from "../convex/lib/validators";
import { BACKOFF_MS, MAX_ATTEMPTS } from "../convex/model/delivery";
import { HEARTBEAT_MAX_AGE_MS } from "../convex/model/heartbeat";
import type { LoanStatus } from "../convex/model/loanMachine";
import { relativeTime } from "./format";

export const ADMIN_TABS = ["loans", "listings", "users", "automation", "audit"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const LOAN_STATUS_FILTERS = [
  "pending",
  "approved",
  "active",
  "returned",
  "declined",
  "cancelled",
  "expired",
] as const satisfies readonly LoanStatus[];

export const ENTITY_TYPES = ["loan", "tool", "user", "outboxEvent", "automationError"] as const satisfies readonly EntityType[];

export const ENTITY_LABEL: Record<EntityType, string> = {
  loan: "Loan",
  tool: "Listing",
  user: "User",
  outboxEvent: "Notification",
  automationError: "Automation error",
};

/** Everything the console keeps in the URL, so links, reloads and Back keep it. */
export interface AdminParams {
  tab: AdminTab;
  /** Loans tab: one status, or all. */
  status: LoanStatus | null;
  /** Loans tab: handed-over loans past their end date. */
  overdue: boolean;
  /** Audit tab: one entity's history (both or neither). */
  entity: { type: EntityType; id: string } | null;
}

const has = <T extends string>(list: readonly T[], value: string | null): value is T =>
  value !== null && (list as readonly string[]).includes(value);

export function parseAdminParams(params: URLSearchParams): AdminParams {
  const tab = params.get("tab");
  const status = params.get("status");
  const type = params.get("entity");
  const id = params.get("id")?.trim() ?? "";
  return {
    tab: has(ADMIN_TABS, tab) ? tab : "loans",
    status: has(LOAN_STATUS_FILTERS, status) ? status : null,
    overdue: params.get("overdue") === "1",
    entity: has(ENTITY_TYPES, type) && id ? { type, id } : null,
  };
}

/** The query string for a state; defaults are left out, so plain /admin stays clean. */
export function adminSearch(state: AdminParams): string {
  const params = new URLSearchParams();
  if (state.tab !== "loans") params.set("tab", state.tab);
  if (state.tab === "loans") {
    if (state.overdue) params.set("overdue", "1");
    else if (state.status) params.set("status", state.status);
  }
  if (state.tab === "audit" && state.entity) {
    params.set("entity", state.entity.type);
    params.set("id", state.entity.id);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** "jh735036aenwtv6aye3vg4pcws8hanxj" → "…8hanxj": the end of a Convex ID, enough to tell rows apart. */
export function shortId(id: string): string {
  return id.length > 6 ? `…${id.slice(-6)}` : id;
}

/** 30_000 → "30 s", 120_000 → "2 min", 3_600_000 → "1 h". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The waits between delivery attempts that actually happen (the last attempt has none). */
export const RETRY_WAITS = BACKOFF_MS.slice(0, MAX_ATTEMPTS - 1).map(formatDuration);

/** How notifications leave LendLoop, from the delivery rules in convex/model/delivery.ts. */
export function deliveryExplainer(): string {
  return (
    "Each email starts as a webhook to n8n signed with HMAC-SHA256. " +
    `If n8n is down or busy, LendLoop tries ${MAX_ATTEMPTS} times, waiting ${listJoin(RETRY_WAITS)} between tries, ` +
    "then keeps the event as a dead letter you can replay. A webhook n8n rejects (bad signature or URL) is a dead letter at once."
  );
}

/** The reminder workflow's schedule (n8n/workflows/overdue-reminders.json; a test keeps them in step). */
export const REMINDER_SCHEDULE = "Daily at 09:00";

export const HEARTBEAT_THRESHOLD = formatDuration(HEARTBEAT_MAX_AGE_MS);

export interface HeartbeatView {
  /** The tile's headline: "Ran 3 hours ago", "Stale", "Never ran". */
  value: string;
  caption: string;
  danger: boolean;
}

/** How the overdue-reminders heartbeat reads on the console. */
export function heartbeatView(lastCheckInAt: number | null, stale: boolean, now: number): HeartbeatView {
  if (lastCheckInAt === null) {
    return { value: "Never ran", caption: "n8n hasn't checked in yet", danger: true };
  }
  const ago = relativeTime(lastCheckInAt, now);
  if (stale) {
    return { value: "Stale", caption: `Last run ${ago}`, danger: true };
  }
  return { value: ago === "just now" ? "Ran just now" : `Ran ${ago}`, caption: REMINDER_SCHEDULE, danger: false };
}

/** What each notification is about, for people reading the problems list. */
export const EVENT_LABEL: Record<EventType, string> = {
  "loan.requested": "New request",
  "loan.approved": "Request approved",
  "loan.declined": "Request declined",
  "loan.cancelled": "Booking cancelled",
  "loan.handed_over": "Tool handed over",
  "loan.returned": "Tool returned",
  "loan.expired": "Request expired",
  "listing.removed": "Listing removed",
};

/** Problem rows: dead letters never reached n8n; failed sends reached n8n but the email didn't go out. */
export const PROBLEM_LABEL: Partial<Record<OutboxStatus, string>> = {
  dead: "Dead letter",
  failed: "Send failed",
};

/** Notifications that still have to reach n8n. */
export function undelivered(counts: Partial<Record<OutboxStatus, number>>): number {
  return (counts.pending ?? 0) + (counts.retrying ?? 0);
}

/** The health query counts at most this many events per status. */
export const COUNT_CAP = 1000;

/** "12", or "1,000+" when the count hit the cap. */
export function countText(count: number, cap = COUNT_CAP): string {
  const text = Intl.NumberFormat("en-US").format(count);
  return count >= cap ? `${text}+` : text;
}

/** Who can see the console: the role comes from the signed-in user's token. */
export type AdminAccess = "loading" | "admin" | "forbidden";

export function adminAccess(me: { role: string } | undefined | null): AdminAccess {
  if (me === undefined || me === null) return "loading";
  return me.role === "admin" ? "admin" : "forbidden";
}
