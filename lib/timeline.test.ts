import { describe, expect, it } from "vitest";
import {
  isShownAsAutomation,
  nextStepCopy,
  notificationEntryCopy,
  reminderEntryCopy,
  statusEntryCopy,
  type StatusEntry,
  type TimelineContext,
  type TimelineViewer,
} from "./timeline";

const ctx = (viewer: TimelineViewer): TimelineContext => ({
  viewer,
  owner: "Marta R.",
  borrower: "Ana L.",
  toolName: "Cordless drill",
  endDate: "2026-11-12",
});
const status = (action: string, actor: string, extra: Partial<StatusEntry> = {}): StatusEntry => ({
  kind: "status",
  action,
  actor,
  ...extra,
});

describe("statusEntryCopy", () => {
  it.each([
    [status("loan.request", "Ana L."), "admin", "Requested by Ana L."],
    [status("loan.request", "Ana L."), "borrower", "Requested by you"],
    [status("loan.approve", "Marta R."), "borrower", "Approved by Marta R."],
    [status("loan.approve", "Marta R."), "owner", "Approved by you"],
    [status("loan.decline", "Marta R.", { reason: "owner_declined" }), "borrower", "Declined by Marta R."],
    [status("loan.decline", "LendLoop", { reason: "dates_taken" }), "borrower", "Declined: dates taken"],
    [status("loan.cancel", "Ana L.", { reason: "borrower_cancelled" }), "owner", "Cancelled by Ana L."],
    [status("loan.cancel", "Marta R.", { reason: "owner_cancelled" }), "owner", "Cancelled by you"],
    [status("loan.handOver", "Marta R."), "borrower", "Handed over"],
    [status("loan.markReturned", "Marta R."), "borrower", "Returned"],
    [status("loan.expire", "LendLoop", { reason: "start_passed" }), "borrower", "Expired: start date passed"],
    [status("loan.expire", "LendLoop", { reason: "not_handed_over" }), "owner", "Expired: not handed over in time"],
    [status("loan.closeForListingRemoval", "Marta R."), "borrower", "Cancelled: listing removed"],
    [status("seed", "LendLoop", { toStatus: "active" }), "owner", "Handed over"],
    [status("something.else", "LendLoop"), "owner", "Updated"],
  ] as const)("%o for %s → %s", (entry, viewer, title) => {
    expect(statusEntryCopy(entry, ctx(viewer)).title).toBe(title);
  });

  it("dates a handover and credits the return", () => {
    expect(statusEntryCopy(status("loan.handOver", "Marta R."), ctx("borrower")).detail).toBe("Due back Nov 12.");
    expect(statusEntryCopy(status("loan.markReturned", "Marta R."), ctx("owner")).detail).toBe("You confirmed it's back.");
    expect(statusEntryCopy(status("loan.markReturned", "Marta R."), ctx("borrower")).detail).toBe(
      "Marta R. confirmed it's back.",
    );
  });
});

describe("notificationEntryCopy", () => {
  it.each([
    ["pending", "owner", "borrower", "Email to Marta queued", false],
    ["delivered", "owner", "borrower", "Email to Marta queued", false],
    ["sent", "borrower", "borrower", "Email to you sent", false],
    ["retrying", "borrower", "borrower", "Email to you failed, retrying", true],
    ["dead", "owner", "admin", "Email to Marta failed", true],
    ["failed", "borrower", "owner", "Email to Ana failed", true],
    ["skipped", "borrower", "owner", "Email to Ana not sent", false],
  ] as const)("%s to %s seen by %s → %s", (state, recipient, viewer, title, failed) => {
    const copy = notificationEntryCopy({ kind: "notification", type: "loan.approved", status: state, recipient }, ctx(viewer));
    expect(copy.title).toBe(title);
    expect(Boolean(copy.failed)).toBe(failed);
    expect(copy.detail).toBe("Request approved");
  });
});

describe("reminderEntryCopy", () => {
  it("names the borrower, or says you", () => {
    expect(reminderEntryCopy({ kind: "reminder", status: "sent" }, ctx("owner")).title).toBe("Reminder sent to Ana");
    expect(reminderEntryCopy({ kind: "reminder", status: "sent" }, ctx("borrower")).title).toBe("Reminder sent to you");
    expect(reminderEntryCopy({ kind: "reminder", status: "failed" }, ctx("owner"))).toMatchObject({
      title: "Reminder failed",
      failed: true,
    });
  });
});

describe("nextStepCopy", () => {
  const loan = { startDate: "2026-11-08", endDate: "2026-11-12", overdue: false };
  it.each([
    ["owner_decision", "borrower", "Marta approves or declines"],
    ["owner_decision", "owner", "You approve or decline"],
    ["handover", "borrower", "Marta confirms the handover"],
    ["handover", "owner", "You confirm the handover"],
    ["return", "owner", "Ana returns the cordless drill by Nov 12"],
    ["return", "borrower", "You return the cordless drill by Nov 12"],
    ["return", "admin", "Ana returns the cordless drill by Nov 12"],
  ] as const)("%s seen by %s → %s", (step, viewer, title) => {
    expect(nextStepCopy(step, loan, ctx(viewer))?.title).toBe(title);
  });

  it("says when the request expires and when a return is late", () => {
    expect(nextStepCopy("owner_decision", loan, ctx("borrower"))?.detail).toBe("By Nov 8, or the request expires.");
    expect(nextStepCopy("return", { ...loan, overdue: true }, ctx("borrower"))?.detail).toMatch(/^It's late\./);
  });

  it("has nothing to say once the loan is closed", () => {
    expect(nextStepCopy(null, loan, ctx("owner"))).toBeNull();
  });
});

describe("isShownAsAutomation", () => {
  it("drops the audit row of a reminder, which has its own entry", () => {
    expect(isShownAsAutomation(status("reminder.sent", "LendLoop"))).toBe(true);
    expect(isShownAsAutomation(status("reminder.failed", "LendLoop"))).toBe(true);
    expect(isShownAsAutomation(status("loan.handOver", "Marta R."))).toBe(false);
  });
});
