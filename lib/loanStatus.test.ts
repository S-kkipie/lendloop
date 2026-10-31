import { describe, expect, it } from "vitest";
import { CLOSE_REASONS } from "../convex/lib/validators";
import { LOAN_STATUSES } from "../convex/model/loanMachine";
import { BADGE_VARIANT_BY_TONE, closeReasonText, loanStatusView, nextActionsFor } from "./loanStatus";

describe("loanStatusView", () => {
  it.each([
    ["pending", "Requested", "neutral"],
    ["approved", "Approved", "accent"],
    ["active", "Handed over", "info"],
    ["returned", "Returned", "ok"],
    ["declined", "Declined", "closed"],
    ["cancelled", "Cancelled", "closed"],
    ["expired", "Expired", "closed"],
  ] as const)("%s → %s (%s)", (status, label, tone) => {
    const view = loanStatusView({ status, overdue: false, daysOverdue: 0 });
    expect(view.label).toBe(label);
    expect(view.tone).toBe(tone);
    expect(view.icon).toBeTruthy();
  });

  it.each([
    [3, "Overdue 3 days"],
    [1, "Overdue 1 day"],
    [0, "Overdue"],
  ])("an overdue loan (%i days) is the only loud state: %s", (daysOverdue, label) => {
    const view = loanStatusView({ status: "active", overdue: true, daysOverdue });
    expect(view).toMatchObject({ label, tone: "danger" });
  });

  it("gives every status a label and an icon", () => {
    for (const status of LOAN_STATUSES) {
      const view = loanStatusView({ status, overdue: false, daysOverdue: 0 });
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.icon).toBeTruthy();
    }
  });

  it("maps every tone to a badge variant", () => {
    expect(BADGE_VARIANT_BY_TONE).toEqual({
      neutral: "neutral",
      accent: "default",
      info: "info",
      ok: "ok",
      closed: "outline",
      danger: "danger",
    });
  });
});

describe("closeReasonText", () => {
  it.each([
    ["dates_taken", "Dates were taken by another booking"],
    ["listing_removed", "Listing was removed"],
    ["owner_declined", "The owner declined"],
    ["borrower_cancelled", "Cancelled by the borrower"],
    ["owner_cancelled", "Cancelled by the owner"],
    ["account_deleted", "The account was deleted"],
    ["not_handed_over", "Not handed over before the end date"],
    ["start_passed", "Start date passed before approval"],
  ] as const)("%s → %s", (reason, text) => {
    expect(closeReasonText(reason)).toBe(text);
  });

  it("covers every close reason the server can send", () => {
    for (const reason of CLOSE_REASONS) expect(closeReasonText(reason)).toMatch(/^[A-Z]/);
  });

  it("returns null when there is no reason", () => {
    expect(closeReasonText(undefined)).toBeNull();
  });
});

describe("nextActionsFor", () => {
  it.each([
    ["owner", "pending", ["approve", "decline"]],
    ["owner", "approved", ["handOver", "cancel"]],
    ["owner", "active", ["markReturned"]],
    ["borrower", "pending", ["cancel"]],
    ["borrower", "approved", ["cancel"]],
    ["borrower", "active", []],
  ] as const)("%s sees %s → %j", (viewer, status, actions) => {
    expect(nextActionsFor(viewer, status)).toEqual(actions);
  });

  it.each(["returned", "declined", "cancelled", "expired"] as const)("%s is terminal for both parties", (status) => {
    expect(nextActionsFor("owner", status)).toEqual([]);
    expect(nextActionsFor("borrower", status)).toEqual([]);
  });
});
