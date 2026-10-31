// Tiny .env reader/writer for generated local config. No quoting or
// interpolation: values are taken verbatim after the first "=".
import { randomBytes } from "node:crypto";

export function parseEnv(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return env;
}

export function serializeEnv(env: Map<string, string>, header?: string): string {
  const lines = [...env].map(([key, value]) => `${key}=${value}`);
  return `${header ? `${header}\n` : ""}${lines.join("\n")}\n`;
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
