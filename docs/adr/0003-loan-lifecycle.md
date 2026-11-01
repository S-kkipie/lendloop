# ADR 0003: Loan lifecycle with explicit handover, derived overdue, auto-decline and expiry

- Status: accepted, 2026-10-31
- Covers: D4, D5, D12 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

"Overdue" only makes sense from the day the tool actually changed hands, not from an approval. A stored overdue flag needs a job to set it and can drift. Overlapping pending requests pile up in the owner's queue once one is approved, and requests nobody answers become zombies.

## Decision

- States: `pending → approved → active → returned`, plus `declined`, `cancelled` and `expired`. The owner confirms both the handover and the return; the borrower cannot self-declare a return.
- The machine is a pure table in `convex/model/loanMachine.ts`. `applyLoanTransition` is the only way to change a status, and it patches, audits and enqueues notifications in one transaction.
- Overdue is derived: `active` and today (in `APP_TIMEZONE`) after `endDate`. Never stored.
- Approving a request auto-declines overlapping pending requests (`dates_taken`) in the same transaction, and each borrower is notified.
- An hourly cron expires pending requests whose start date passed and approved loans never handed over by their end date.

## Consequences

- No status change without an audit entry and an event, by construction.
- No overdue job to fail; reminders and the UI compute the same answer.
- Convex's serializable mutations make racing approvals safe: the loser sees `CONFLICT`.
- The owner must press "Hand over", one extra step the UI makes prominent.
