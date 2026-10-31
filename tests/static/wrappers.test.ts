import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const CONVEX_DIR = fileURLToPath(new URL("../../convex", import.meta.url));
const BUILDERS = new Set([
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction",
]);
const RAW_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.?\/)+_generated\/server["']/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Deployed Convex modules: single-dot .ts files outside _generated.
const deployedFiles = walk(CONVEX_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => !relative(CONVEX_DIR, f).startsWith("_generated"))
  .filter((f) => basename(f).split(".").length === 2);

test("only lib/functions.ts imports raw function builders", () => {
  const offenders: string[] = [];
  for (const file of deployedFiles) {
    const rel = relative(CONVEX_DIR, file);
    if (rel === join("lib", "functions.ts")) continue;
    for (const match of readFileSync(file, "utf8").matchAll(RAW_IMPORT)) {
      const names = match[1]
        .split(",")
        .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
        .filter(Boolean);
      for (const name of names) if (BUILDERS.has(name)) offenders.push(`${rel}: ${name}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("publicQuery is used only by tools.listPublic", () => {
  const uses: string[] = [];
  for (const file of deployedFiles) {
    const rel = relative(CONVEX_DIR, file);
    if (rel === join("lib", "functions.ts")) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/export const (\w+) = publicQuery\(/g)) {
      uses.push(`${rel}:${match[1]}`);
    }
  }
  expect(uses.filter((u) => u !== "tools.ts:listPublic")).toEqual([]);
});
