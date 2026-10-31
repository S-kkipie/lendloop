// Structured JSON logs with personal data removed before anything is written.
const REDACTED_KEYS = new Set(["email", "name", "firstName", "message", "recipient", "body"]);
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]");
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, REDACTED_KEYS.has(key) ? "[redacted]" : redact(inner, depth + 1)]),
    );
  }
  return value;
}

export function sanitizeError(text: string, max = 300): string {
  return text.replace(EMAIL, "[email]").replace(/\s+/g, " ").trim().slice(0, max);
}

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ...(redact(fields) as Record<string, unknown>) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
