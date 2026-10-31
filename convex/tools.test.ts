import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { NOW, expectCode, insertLoan, seedWorld, setupTest } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const trimmer = { name: "  Hedge   trimmer ", category: "garden", condition: "good", description: " Electric " } as const;

describe("listPublic", () => {
  test("anonymous callers get name and category only, without tools on loan", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const onLoan = await w.alice.as.mutation(api.tools.create, { ...trimmer, name: "Ladder" });
    await insertLoan(t, w, { toolId: onLoan, status: "active" });

    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toEqual([{ _id: w.toolId, name: "Cordless drill", category: "power_tools" }]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["_id", "category", "name"]);
  });
});

describe("create and update", () => {
  test("create trims fields and audits", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const id = await w.bob.as.mutation(api.tools.create, trimmer);
    const tool = await t.run((ctx) => ctx.db.get(id));
    expect(tool).toMatchObject({ name: "Hedge trimmer", description: "Electric", ownerId: w.bob.id, status: "listed" });
    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits.at(-1)).toMatchObject({ action: "tool.create", entityId: id, actorId: w.bob.id });
  });

  test("create rejects bad names", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await expectCode(w.bob.as.mutation(api.tools.create, { ...trimmer, name: "ab" }), "INVALID");
    await expectCode(w.bob.as.mutation(api.tools.create, { ...trimmer, name: "x".repeat(61) }), "INVALID");
  });

  test("create is rate limited to 20 per day", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    for (let i = 0; i < 20; i++) {
      await w.carol.as.mutation(api.tools.create, { ...trimmer, name: `Tool ${i + 100}` });
    }
    await expectCode(w.carol.as.mutation(api.tools.create, { ...trimmer, name: "One too many" }), "RATE_LIMITED");
  });

  test("only the owner can update", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const edit = { toolId: w.toolId, ...trimmer, name: "Impact drill" };
    await expectCode(w.bob.as.mutation(api.tools.update, edit), "FORBIDDEN");
    await expectCode(w.dana.as.mutation(api.tools.update, edit), "FORBIDDEN");
    await w.alice.as.mutation(api.tools.update, edit);
    expect((await t.run((ctx) => ctx.db.get(w.toolId)))?.name).toBe("Impact drill");
  });
});

describe("remove", () => {
  test("blocked while a loan is active", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "active" });
    await expectCode(w.alice.as.mutation(api.tools.remove, { toolId: w.toolId }), "CONFLICT");
  });

  test("cancels open requests and notifies their borrowers", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const pending = await insertLoan(t, w, { status: "pending" });
    const approved = await insertLoan(t, w, {
      status: "approved",
      borrowerId: w.carol.id,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });
    const result = await w.alice.as.mutation(api.tools.remove, { toolId: w.toolId });
    expect(result).toEqual({ cancelledLoans: 2 });

    const state = await t.run(async (ctx) => ({
      tool: await ctx.db.get(w.toolId),
      pending: await ctx.db.get(pending),
      approved: await ctx.db.get(approved),
      events: await ctx.db.query("outboxEvents").collect(),
    }));
    expect(state.tool?.status).toBe("removed");
    expect(state.pending).toMatchObject({ status: "cancelled", closeReason: "listing_removed" });
    expect(state.approved).toMatchObject({ status: "cancelled", closeReason: "listing_removed" });
    expect(state.events.map((e) => [e.type, e.recipientId]).sort()).toEqual(
      [
        ["listing.removed", w.bob.id],
        ["listing.removed", w.carol.id],
      ].sort(),
    );
    expect(await w.bob.as.query(api.tools.browse, {})).toEqual([]);
  });
});

describe("get and browse", () => {
  test("get shows booked ranges without borrower identity", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await insertLoan(t, w, { status: "approved" });
    await insertLoan(t, w, { status: "returned", startDate: "2026-10-01", endDate: "2026-10-02" });
    const tool = await w.carol.as.query(api.tools.get, { toolId: w.toolId });
    expect(tool.bookedRanges).toEqual([{ startDate: "2026-11-05", endDate: "2026-11-07" }]);
    expect(tool.owner).toEqual({ displayName: "Alice M.", isTrustedLender: false });
    expect(JSON.stringify(tool)).not.toContain("Bob");
  });

  test("removed tools are hidden from non-owners", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    await w.alice.as.mutation(api.tools.remove, { toolId: w.toolId });
    await expectCode(w.carol.as.query(api.tools.get, { toolId: w.toolId }), "NOT_FOUND");
    expect((await w.alice.as.query(api.tools.get, { toolId: w.toolId })).status).toBe("removed");
  });

  test("browse filters by category, availability and search", async () => {
    const t = setupTest();
    const w = await seedWorld(t);
    const trimmerId = await w.bob.as.mutation(api.tools.create, trimmer);
    await insertLoan(t, w, { status: "active" }); // drill on loan

    expect((await w.carol.as.query(api.tools.browse, { category: "garden" })).map((r) => r._id)).toEqual([trimmerId]);
    expect((await w.carol.as.query(api.tools.browse, { availableOnly: true })).map((r) => r._id)).toEqual([trimmerId]);
    const found = await w.carol.as.query(api.tools.browse, { search: "DRILL" });
    expect(found).toHaveLength(1);
    expect(found[0].availability).toEqual({ state: "on_loan", until: "2026-11-07" });
  });
});
