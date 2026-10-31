/// <reference types="vite/client" />
// Test-only helpers (two dots in the filename: never deployed).
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import type { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ErrorCode } from "./lib/errors";
import schema from "./schema";

export const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts", "!./**/*.helpers.ts"]);

const issuer = "https://clerk.test";
const identity = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  subject: id,
  issuer,
  tokenIdentifier: `${issuer}|${id}`,
  name,
  email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  ...extra,
});

export const people = {
  alice: identity("user_alice", "Alice Moreno"),
  bob: identity("user_bob", "Bob Keller"),
  carol: identity("user_carol", "Carol Diaz"),
  dana: identity("user_dana", "Dana Okafor", { role: "admin" }),
} as const;
export type Person = keyof typeof people;

export const NOW = Date.parse("2026-11-02T12:00:00Z");

export function setupTest() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  return t;
}
export type TestT = ReturnType<typeof setupTest>;

export async function signIn(t: TestT, who: Person) {
  const as = t.withIdentity(people[who]);
  const id = await as.mutation(api.users.syncMe, {});
  return { as, id };
}

export async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} but the call succeeded`).toBeDefined();
  const data = (caught as ConvexError<{ code: string }>).data;
  expect(data?.code, String(caught)).toBe(code);
}

export async function seedWorld(t: TestT) {
  const alice = await signIn(t, "alice"); // tool owner
  const bob = await signIn(t, "bob"); // borrower
  const carol = await signIn(t, "carol"); // unrelated neighbour
  const dana = await signIn(t, "dana"); // admin
  const toolId = await t.run((ctx) =>
    ctx.db.insert("tools", {
      ownerId: alice.id,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "18V with two batteries",
      status: "listed",
      updatedAt: Date.now(),
    }),
  );
  return { alice, bob, carol, dana, toolId };
}
export type World = Awaited<ReturnType<typeof seedWorld>>;

export async function insertLoan(
  t: TestT,
  world: World,
  fields: Partial<Omit<Doc<"loans">, "_id" | "_creationTime">> = {},
): Promise<Id<"loans">> {
  return await t.run((ctx) =>
    ctx.db.insert("loans", {
      toolId: world.toolId,
      ownerId: world.alice.id,
      borrowerId: world.bob.id,
      startDate: "2026-11-05",
      endDate: "2026-11-07",
      status: "pending",
      ...fields,
    }),
  );
}
