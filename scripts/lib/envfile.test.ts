import { expect, test } from "vitest";
import { parseEnv, randomSecret, serializeEnv } from "./envfile";

test("parses KEY=value lines, ignores comments and blanks, keeps = inside values", () => {
  const env = parseEnv("# c\nA=1\n\nB=x=y\n  C = spaced \n");
  expect([...env]).toEqual([
    ["A", "1"],
    ["B", "x=y"],
    ["C", "spaced"],
  ]);
});

test("serializes deterministically with an optional header", () => {
  expect(
    serializeEnv(
      new Map([
        ["A", "1"],
        ["B", "2"],
      ]),
      "# generated",
    ),
  ).toBe("# generated\nA=1\nB=2\n");
});

test("randomSecret is hex of the requested size and unique", () => {
  const a = randomSecret();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(randomSecret()).not.toBe(a);
  expect(randomSecret(16)).toMatch(/^[0-9a-f]{32}$/);
});
