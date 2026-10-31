// Static lint of the exported n8n workflows: no secrets, only allowlisted
// placeholders, retries on every network/email node, error routing, raw body.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const DIR = fileURLToPath(new URL("../../n8n/workflows", import.meta.url));
type Node = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string } & Record<string, unknown>>;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
};
type Connections = Record<string, { main: { node: string }[][] }>;
type Workflow = {
  id: string;
  name: string;
  nodes: Node[];
  connections: Connections;
  settings?: { errorWorkflow?: string };
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const workflows = files.map((f) => ({ file: f, raw: readFileSync(join(DIR, f), "utf8") }));
const parsed = workflows.map((w) => ({ ...w, json: JSON.parse(w.raw) as Workflow }));

const SECRET_PATTERNS = [
  /[0-9a-f]{40,}/i,
  /whsec_/,
  /sk_(test|live)_/,
  /pk_(test|live)_/,
  /"password"\s*:\s*"[^"{]/i,
  /hmacSecret/,
];
const ALLOWED_PLACEHOLDERS = new Set(["{{CONVEX_SITE_URL}}", "{{MAIL_FROM}}", "{{OPS_EMAIL}}"]);

test("exactly the three LendLoop workflows are exported", () => {
  expect(parsed.map((w) => w.json.id).sort()).toEqual(["llErrorHandler001", "llLoanNotify0001", "llOverdueRemind01"]);
});

describe.each(parsed)("$file", ({ raw, json }) => {
  test("contains no secrets or credential data", () => {
    for (const pattern of SECRET_PATTERNS) expect(raw, String(pattern)).not.toMatch(pattern);
    for (const node of json.nodes) {
      for (const ref of Object.values(node.credentials ?? {})) expect(Object.keys(ref).sort()).toEqual(["id", "name"]);
    }
  });

  test("only allowlisted placeholders", () => {
    const found = raw.match(/\{\{[A-Z_]+\}\}/g) ?? [];
    for (const placeholder of found) expect(ALLOWED_PLACEHOLDERS.has(placeholder), placeholder).toBe(true);
  });

  test("network and email nodes retry", () => {
    for (const node of json.nodes.filter((n) => /httpRequest|emailSend/.test(n.type))) {
      expect(node.retryOnFail, node.name).toBe(true);
      expect(node.maxTries ?? 0, node.name).toBeGreaterThanOrEqual(3);
      expect(node.waitBetweenTries ?? 0, node.name).toBeGreaterThanOrEqual(1000);
    }
  });

  test("Code nodes do not require node builtins", () => {
    for (const node of json.nodes.filter((n) => n.type === "n8n-nodes-base.code")) {
      expect(String(node.parameters.jsCode), node.name).not.toMatch(/require\(/);
    }
  });

  test("connections and $('…') references point at existing nodes", () => {
    const names = new Set(json.nodes.map((n) => n.name));
    for (const [from, { main }] of Object.entries(json.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const target of main.flat()) expect(names.has(target.node), `${from} -> ${target.node}`).toBe(true);
    }
    for (const match of raw.matchAll(/\$\('([^']+)'\)/g)) expect(names.has(match[1]), match[1]).toBe(true);
  });

  test("emails carry no n8n attribution", () => {
    for (const node of json.nodes.filter((n) => n.type === "n8n-nodes-base.emailSend")) {
      expect((node.parameters.options as Record<string, unknown>)?.appendAttribution, node.name).toBe(false);
    }
  });

  test("webhook responses are fixed bodies that never echo request data", () => {
    for (const node of json.nodes.filter((n) => n.type === "n8n-nodes-base.respondToWebhook")) {
      const body = String(node.parameters.responseBody);
      expect(body.startsWith("="), node.name).toBe(false);
      expect(() => JSON.parse(body), node.name).not.toThrow();
    }
  });
});

test("main workflows route failures to the error handler", () => {
  for (const id of ["llLoanNotify0001", "llOverdueRemind01"]) {
    expect(parsed.find((w) => w.json.id === id)?.json.settings?.errorWorkflow).toBe("llErrorHandler001");
  }
});

test("the webhook keeps the raw body for signature checks", () => {
  const notify = parsed.find((w) => w.json.id === "llLoanNotify0001")!.json;
  const webhook = notify.nodes.find((n) => n.type === "n8n-nodes-base.webhook")!;
  expect(webhook.parameters).toMatchObject({
    path: "lendloop-loan-events",
    responseMode: "responseNode",
    options: { rawBody: true },
  });
});

test("the three webhook outcomes answer with the contract bodies and codes", () => {
  const notify = parsed.find((w) => w.json.id === "llLoanNotify0001")!.json;
  const responses = Object.fromEntries(
    notify.nodes
      .filter((n) => n.type === "n8n-nodes-base.respondToWebhook")
      .map((n) => [
        JSON.parse(String(n.parameters.responseBody)) as unknown,
        (n.parameters.options as { responseCode?: number }).responseCode,
      ])
      .map(([body, code]) => [JSON.stringify(body), code]),
  );
  expect(responses).toEqual({ '{"error":"unauthorized"}': 401, '{"duplicate":true}': 200, '{"accepted":true}': 202 });
});
