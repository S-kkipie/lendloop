/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.test.ts", "!./**/*.helpers.ts"]);

test("schema accepts a valid tool and rejects an unknown category", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      tokenIdentifier: "https://clerk.test|user_a",
      clerkId: "user_a",
      name: "Alice Moreno",
      email: "alice@example.com",
      isTrustedLender: false,
    });
    await ctx.db.insert("tools", {
      ownerId,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "",
      status: "listed",
      updatedAt: Date.now(),
    });
    await expect(
      ctx.db.insert("tools", {
        ownerId,
        name: "Spaceship",
        // @ts-expect-error invalid category on purpose
        category: "spaceships",
        condition: "good",
        description: "",
        status: "listed",
        updatedAt: Date.now(),
      }),
    ).rejects.toThrow();
  });
});
