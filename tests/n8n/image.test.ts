// The n8n hardening defaults ship in the image (n8n/Dockerfile), so a deployment
// that only runs the image (Railway) gets them; compose may override only the
// local-only values.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dockerfile = read("../../n8n/Dockerfile");
const compose = read("../../docker-compose.yml");

const HARDENING = {
  DB_TYPE: "postgresdb",
  N8N_SECURE_COOKIE: "true",
  N8N_INSTANCE_OWNER_MANAGED_BY_ENV: "true",
  N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
  N8N_PUBLIC_API_DISABLED: "true",
  EXECUTIONS_DATA_SAVE_ON_SUCCESS: "none",
  EXECUTIONS_DATA_SAVE_ON_ERROR: "all",
  EXECUTIONS_DATA_MAX_AGE: "168",
  EXECUTIONS_DATA_PRUNE: "true",
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_PERSONALIZATION_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
  N8N_TEMPLATES_ENABLED: "false",
};

/** KEY=value pairs of the Dockerfile's ENV instructions (with line continuations). */
function imageEnv(): Record<string, string> {
  const joined = dockerfile.replace(/\\\n/g, " ");
  const env: Record<string, string> = {};
  for (const line of joined.split("\n").filter((l) => /^ENV\s/.test(l))) {
    for (const [, key, value] of line.matchAll(/([A-Z0-9_]+)=(\S+)/g)) env[key] = value;
  }
  return env;
}

test("the image sets every hardening default", () => {
  expect(imageEnv()).toEqual(HARDENING);
});

test("the image pins the n8n version", () => {
  expect(dockerfile).toMatch(/^FROM n8nio\/n8n:\d+\.\d+\.\d+$/m);
});

test("compose overrides only local-only values, never a hardening default except the cookie", () => {
  for (const key of Object.keys(HARDENING).filter((k) => k !== "N8N_SECURE_COOKIE")) {
    expect(compose, key).not.toMatch(new RegExp(`^\\s+${key}:`, "m"));
  }
  expect(compose).toMatch(/^\s+N8N_SECURE_COOKIE: "false"/m);
});
