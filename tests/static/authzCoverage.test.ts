import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { MATRIX } from "../authz/matrix";

const CONVEX_DIR = fileURLToPath(new URL("../../convex", import.meta.url));
const PUBLIC_EXPORT =
  /export const (\w+) = (publicQuery|identityMutation|userQuery|userMutation|adminQuery|adminMutation)\(/g;

test("every public Convex function appears in the authorization matrix", () => {
  const found: string[] = [];
  for (const entry of readdirSync(CONVEX_DIR)) {
    if (!entry.endsWith(".ts") || entry.split(".").length !== 2) continue;
    const source = readFileSync(join(CONVEX_DIR, entry), "utf8");
    for (const match of source.matchAll(PUBLIC_EXPORT)) {
      found.push(`${entry.replace(/\.ts$/, "")}:${match[1]}`);
    }
  }
  expect(found.sort()).toEqual(MATRIX.map((row) => row.fn).sort());
});
