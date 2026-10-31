import type { FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACTORS, MATRIX, type Actor } from "../tests/authz/matrix";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOW, expectCode, insertLoan, seedWorld, setupTest, type TestT, type World } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

type Needs = "none" | "pending" | "approved" | "active";
type Ctx = World & { loanId: Id<"loans"> };
type Call = {
  kind: "query" | "mutation";
  ref: FunctionReference<"query" | "mutation", "public">;
  needs: Needs;
  args: (c: Ctx) => Record<string, unknown>;
};

const toolEdit = (c: Ctx) => ({
  toolId: c.toolId,
  name: "Impact drill",
  category: "power_tools",
  condition: "good",
  description: "",
});

const CALLS: Record<string, Call> = {
  "tools:listPublic": { kind: "query", ref: api.tools.listPublic, needs: "none", args: () => ({}) },
  "tools:browse": { kind: "query", ref: api.tools.browse, needs: "none", args: () => ({}) },
  "tools:get": { kind: "query", ref: api.tools.get, needs: "none", args: (c) => ({ toolId: c.toolId }) },
  "tools:mine": { kind: "query", ref: api.tools.mine, needs: "none", args: () => ({}) },
  "tools:create": {
    kind: "mutation",
    ref: api.tools.create,
    needs: "none",
    args: () => ({ name: "Stand mixer", category: "kitchen", condition: "good", description: "" }),
  },
  "tools:update": { kind: "mutation", ref: api.tools.update, needs: "none", args: toolEdit },
  "tools:remove": { kind: "mutation", ref: api.tools.remove, needs: "none", args: (c) => ({ toolId: c.toolId }) },
  "loans:request": {
    kind: "mutation",
    ref: api.loans.request,
    needs: "none",
    args: (c) => ({ toolId: c.toolId, startDate: "2026-11-05", endDate: "2026-11-07" }),
  },
  "loans:approve": { kind: "mutation", ref: api.loans.approve, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "loans:decline": { kind: "mutation", ref: api.loans.decline, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "loans:cancel": { kind: "mutation", ref: api.loans.cancel, needs: "approved", args: (c) => ({ loanId: c.loanId }) },
  "loans:handOver": { kind: "mutation", ref: api.loans.handOver, needs: "approved", args: (c) => ({ loanId: c.loanId }) },
  "loans:markReturned": {
    kind: "mutation",
    ref: api.loans.markReturned,
    needs: "active",
    args: (c) => ({ loanId: c.loanId }),
  },
  "loans:myRequests": { kind: "query", ref: api.loans.myRequests, needs: "none", args: () => ({}) },
  "loans:incoming": { kind: "query", ref: api.loans.incoming, needs: "none", args: () => ({}) },
  "loans:timeline": { kind: "query", ref: api.loans.timeline, needs: "pending", args: (c) => ({ loanId: c.loanId }) },
  "users:syncMe": { kind: "mutation", ref: api.users.syncMe, needs: "none", args: () => ({}) },
  "users:me": { kind: "query", ref: api.users.me, needs: "none", args: () => ({}) },
  "admin:listLoans": { kind: "query", ref: api.admin.listLoans, needs: "none", args: () => ({}) },
  "admin:listTools": { kind: "query", ref: api.admin.listTools, needs: "none", args: () => ({}) },
  "admin:listUsers": { kind: "query", ref: api.admin.listUsers, needs: "none", args: () => ({}) },
  "admin:removeTool": {
    kind: "mutation",
    ref: api.admin.removeTool,
    needs: "none",
    args: (c) => ({ toolId: c.toolId, reason: "Policy check" }),
  },
  "admin:setTrustedLender": {
    kind: "mutation",
    ref: api.admin.setTrustedLender,
    needs: "none",
    args: (c) => ({ userId: c.alice.id, trusted: true }),
  },
  "admin:auditLog": { kind: "query", ref: api.admin.auditLog, needs: "none", args: () => ({}) },
};

test("every matrix row has an executable call and vice versa", () => {
  expect(Object.keys(CALLS).sort()).toEqual(MATRIX.map((row) => row.fn).sort());
});

function accessorFor(t: TestT, w: World, actor: Actor) {
  switch (actor) {
    case "anonymous":
      return t;
    case "owner":
      return w.alice.as;
    case "borrower":
      return w.bob.as;
    case "otherUser":
      return w.carol.as;
    case "admin":
      return w.dana.as;
  }
}

describe.each(MATRIX)("$fn", (row) => {
  test.each([...ACTORS])("as %s", async (actor) => {
    const t = setupTest();
    const w = await seedWorld(t);
    const call = CALLS[row.fn];
    const loanId =
      call.needs === "none" ? (undefined as unknown as Id<"loans">) : await insertLoan(t, w, { status: call.needs });
    const who = accessorFor(t, w, actor);
    const args = call.args({ ...w, loanId });
    const promise =
      call.kind === "query"
        ? who.query(call.ref as FunctionReference<"query">, args)
        : who.mutation(call.ref as FunctionReference<"mutation">, args);

    const expected = row.expect[actor];
    if (expected === "allow") {
      await promise; // rejects → test fails with the real error
    } else {
      await expectCode(promise, expected);
    }
  });
});
