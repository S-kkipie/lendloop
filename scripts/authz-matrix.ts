import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderMatrix } from "../tests/authz/matrix";

const target = fileURLToPath(new URL("../docs/authz-matrix.md", import.meta.url));
const next = renderMatrix();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // a missing file counts as stale
  }
  if (current !== next) {
    console.error("docs/authz-matrix.md is stale. Run `pnpm docs:authz`.");
    process.exit(1);
  }
  console.log("docs/authz-matrix.md is up to date.");
} else {
  writeFileSync(target, next);
  console.log("Wrote docs/authz-matrix.md");
}
