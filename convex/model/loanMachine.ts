// Pure loan state machine: (status, action, actor) → next status.
export const LOAN_STATUSES = [
  "pending",
  "approved",
  "active",
  "returned",
  "declined",
  "cancelled",
  "expired",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export type LoanAction =
  | "approve"
  | "decline"
  | "cancel"
  | "handOver"
  | "markReturned"
  | "expire"
  | "closeForListingRemoval"
  | "closeForAccountDeletion";

export type LoanActor = "owner" | "borrower" | "system";

interface Rule {
  from: readonly LoanStatus[];
  actor: LoanActor;
  to: LoanStatus;
}

const RULES: Record<LoanAction, readonly Rule[]> = {
  approve: [{ from: ["pending"], actor: "owner", to: "approved" }],
  decline: [
    { from: ["pending"], actor: "owner", to: "declined" },
    { from: ["pending"], actor: "system", to: "declined" }, // auto-decline: dates taken
  ],
  cancel: [
    { from: ["pending", "approved"], actor: "borrower", to: "cancelled" },
    { from: ["approved"], actor: "owner", to: "cancelled" },
  ],
  handOver: [{ from: ["approved"], actor: "owner", to: "active" }],
  markReturned: [{ from: ["active"], actor: "owner", to: "returned" }],
  expire: [{ from: ["pending", "approved"], actor: "system", to: "expired" }],
  closeForListingRemoval: [{ from: ["pending", "approved"], actor: "system", to: "cancelled" }],
  closeForAccountDeletion: [{ from: ["pending", "approved"], actor: "system", to: "cancelled" }],
};

export function nextStatus(from: LoanStatus, action: LoanAction, actor: LoanActor): LoanStatus | null {
  const rule = RULES[action].find((r) => r.actor === actor && r.from.includes(from));
  return rule ? rule.to : null;
}

export const TERMINAL_STATUSES: readonly LoanStatus[] = ["returned", "declined", "cancelled", "expired"];
export const BLOCKING_STATUSES: readonly LoanStatus[] = ["approved", "active"];

export function isTerminal(status: LoanStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type NextStep = "owner_decision" | "handover" | "return" | null;

export function nextStep(status: LoanStatus): NextStep {
  if (status === "pending") return "owner_decision";
  if (status === "approved") return "handover";
  if (status === "active") return "return";
  return null;
}
