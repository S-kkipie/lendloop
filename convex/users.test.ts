import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { expectCode, people, setupTest, signIn } from "./test.helpers";

test("syncMe requires a token", async () => {
  const t = setupTest();
  await expectCode(t.mutation(api.users.syncMe, {}), "UNAUTHENTICATED");
});

test("syncMe creates once, then updates name and email", async () => {
  const t = setupTest();
  const first = await signIn(t, "alice");
  const again = await first.as.mutation(api.users.syncMe, {});
  expect(again).toBe(first.id);

  const renamed = t.withIdentity({ ...people.alice, name: "Alice Romero", email: "a.romero@example.com" });
  await renamed.mutation(api.users.syncMe, {});
  const row = await t.run((ctx) => ctx.db.get(first.id));
  expect(row?.name).toBe("Alice Romero");
  expect(row?.email).toBe("a.romero@example.com");
});

test("me exposes display name and role from the token", async () => {
  const t = setupTest();
  const alice = await signIn(t, "alice");
  const dana = await signIn(t, "dana");
  expect(await alice.as.query(api.users.me, {})).toMatchObject({ displayName: "Alice M.", role: "user" });
  expect(await dana.as.query(api.users.me, {})).toMatchObject({ role: "admin" });
});

test("unknown role claims get least privilege", async () => {
  const t = setupTest();
  const weird = t.withIdentity({ ...people.carol, role: "superuser" });
  await weird.mutation(api.users.syncMe, {});
  expect(await weird.query(api.users.me, {})).toMatchObject({ role: "user" });
});

test("me before syncMe, or after deletion, is unauthenticated", async () => {
  const t = setupTest();
  await expectCode(t.withIdentity(people.bob).query(api.users.me, {}), "UNAUTHENTICATED");

  const bob = await signIn(t, "bob");
  await t.run((ctx) => ctx.db.patch(bob.id, { deletedAt: Date.now() }));
  await expectCode(bob.as.query(api.users.me, {}), "UNAUTHENTICATED");
});
