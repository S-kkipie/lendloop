import { expect, test } from "vitest";

test("toolchain runs in edge-runtime", () => {
  expect(typeof crypto.subtle.sign).toBe("function");
});
