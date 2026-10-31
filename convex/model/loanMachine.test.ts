import { describe, expect, test } from "vitest";
import {
  LOAN_STATUSES,
  TERMINAL_STATUSES,
  isTerminal,
  nextStatus,
  nextStep,
  type LoanAction,
  type LoanActor,
  type LoanStatus,
} from "./loanMachine";

const ACTIONS: LoanAction[] = [
  "approve",
  "decline",
  "cancel",
  "handOver",
  "markReturned",
  "expire",
  "closeForListingRemoval",
  "closeForAccountDeletion",
];
const ACTORS: LoanActor[] = ["owner", "borrower", "system"];

describe("allowed transitions", () => {
  test.each([
    ["pending", "approve", "owner", "approved"],
    ["pending", "decline", "owner", "declined"],
    ["pending", "decline", "system", "declined"],
    ["pending", "cancel", "borrower", "cancelled"],
    ["approved", "cancel", "borrower", "cancelled"],
    ["approved", "cancel", "owner", "cancelled"],
    ["approved", "handOver", "owner", "active"],
    ["active", "markReturned", "owner", "returned"],
    ["pending", "expire", "system", "expired"],
    ["approved", "expire", "system", "expired"],
    ["pending", "closeForListingRemoval", "system", "cancelled"],
    ["approved", "closeForListingRemoval", "system", "cancelled"],
    ["pending", "closeForAccountDeletion", "system", "cancelled"],
    ["approved", "closeForAccountDeletion", "system", "cancelled"],
  ] as const)("%s --%s(%s)--> %s", (from, action, actor, to) => {
    expect(nextStatus(from, action, actor)).toBe(to);
  });
});

describe("rejected transitions", () => {
  test.each([
    ["pending", "approve", "borrower"],
    ["approved", "approve", "owner"],
    ["approved", "decline", "owner"],
    ["pending", "cancel", "owner"],
    ["active", "cancel", "borrower"],
    ["active", "cancel", "owner"],
    ["pending", "handOver", "owner"],
    ["approved", "handOver", "borrower"],
    ["active", "markReturned", "borrower"],
    ["approved", "markReturned", "owner"],
    ["active", "expire", "system"],
    ["active", "closeForListingRemoval", "system"],
    ["pending", "expire", "owner"],
  ] as const)("%s --%s(%s)--> null", (from, action, actor) => {
    expect(nextStatus(from, action, actor)).toBeNull();
  });

  test("terminal statuses never transition", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const action of ACTIONS) {
        for (const actor of ACTORS) {
          expect(nextStatus(from, action, actor), `${from}/${action}/${actor}`).toBeNull();
        }
      }
    }
  });
});

test("terminal set", () => {
  const terminal: LoanStatus[] = ["returned", "declined", "cancelled", "expired"];
  for (const status of LOAN_STATUSES) {
    expect(isTerminal(status)).toBe(terminal.includes(status));
  }
});

test("nextStep", () => {
  expect(nextStep("pending")).toBe("owner_decision");
  expect(nextStep("approved")).toBe("handover");
  expect(nextStep("active")).toBe("return");
  expect(nextStep("returned")).toBeNull();
});
