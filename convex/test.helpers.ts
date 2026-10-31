/// <reference types="vite/client" />
// Test-only helpers (two dots in the filename: never deployed).
import { convexTest } from "convex-test";
import type { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "./_generated/api";
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
