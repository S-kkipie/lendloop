// Local stand-in for Resend's email API, used only by the docker-compose stack.
// n8n sends the same request it sends to Resend in production (POST /emails
// with a bearer key and an Idempotency-Key); this server checks the key,
// honours the Idempotency-Key the way Resend does, and relays the message over
// SMTP to Mailpit, so Mailpit's chaos mode can still make sends fail in the E2E.
// No dependencies: run with `node n8n/local-mail-api.ts` (Node 24 strips types).
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

export type Email = { from: string; to: string[]; subject: string; text: string };
export type Smtp = { host: string; port: number };
type Reply = { code: number; text: string };
type Stored = { fingerprint: string; expiresAt: number; response?: { status: number; body: unknown } };

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // Resend keeps keys for 24 hours
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECIPIENTS = 50;
const ADDRESS = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+$/;

export class SmtpError extends Error {
  code: number;
  constructor(code: number, text: string) {
    super(`SMTP ${code} ${text}`.trim());
    this.code = code;
  }
}

/** "LendLoop <no-reply@x.dev>" or "no-reply@x.dev" -> name and address; null when malformed. */
export function parseMailbox(value: string): { name: string; address: string } | null {
  const named = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  const name = named ? named[1].replace(/^"(.*)"$/, "$1") : "";
  const address = (named ? named[2] : value).trim();
  return ADDRESS.test(address) ? { name, address } : null;
}

/** Validates a Resend-style request body; returns the email or a validation message. */
export function parseEmail(body: unknown): Email | string {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object";
  const { from, to, subject, text } = body as Record<string, unknown>;
  const recipients = typeof to === "string" ? [to] : to;
  if (typeof from !== "string" || !parseMailbox(from)) return "`from` must be an email address";
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    return `\`to\` must be an address or a list of 1 to ${MAX_RECIPIENTS} addresses`;
  }
  if (!recipients.every((r) => typeof r === "string" && ADDRESS.test(r.trim()))) return "`to` holds an invalid address";
  if (typeof subject !== "string" || subject.trim() === "") return "`subject` is required";
  if (/[\r\n]/.test(subject) || /[\r\n]/.test(from)) return "Header fields cannot contain line breaks";
  if (typeof text !== "string") return "`text` is required (this local API sends plain text only)";
  return { from, to: recipients.map((r: string) => r.trim()), subject, text };
}

const encodeWord = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

function formatMailbox(value: string): string {
  const { name, address } = parseMailbox(value)!;
  if (!name) return address;
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeWord(name);
  return `${display} <${address}>`;
}

/** RFC 5322 message with a base64 UTF-8 body: no line-length or dot-stuffing concerns. */
export function buildMessage(email: Email, messageId: string, date: Date): string {
  const body = Buffer.from(email.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return [
    `From: ${formatMailbox(email.from)}`,
    `To: ${email.to.join(", ")}`,
    `Subject: ${encodeWord(email.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...(body.match(/.{1,76}/g) ?? [""]),
  ].join("\r\n");
}

/** Reads complete (possibly multi-line) SMTP replies from the socket, one per call. */
function replyReader(socket: ReturnType<typeof connect>): () => Promise<Reply> {
  let buffer = "";
  let lines: string[] = [];
  let failure: Error | undefined;
  const ready: Reply[] = [];
  let waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | undefined;

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      lines.push(line);
      if (!/^\d{3}(?: |$)/.test(line)) continue; // "250-..." continues the reply
      const reply = { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join(" ") };
      lines = [];
      if (waiting) {
        waiting.resolve(reply);
        waiting = undefined;
      } else ready.push(reply);
    }
  });
  const fail = (error: Error) => {
    failure ??= error;
    waiting?.reject(failure);
    waiting = undefined;
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("SMTP connection closed")));
  socket.on("timeout", () => {
    fail(new Error("SMTP timeout"));
    socket.destroy();
  });

  return () => {
    const next = ready.shift();
    if (next) return Promise.resolve(next);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => (waiting = { resolve, reject }));
  };
}

/** Minimal SMTP client: plain connection, no auth (Mailpit inside the compose network). */
export async function sendSmtp(smtp: Smtp, email: Email, message: string): Promise<void> {
  const socket = connect(smtp.port, smtp.host);
  socket.setTimeout(10_000);
  const next = replyReader(socket);
  const step = async (command: string | null, ok: number[]) => {
    if (command !== null) socket.write(`${command}\r\n`);
    const reply = await next();
    if (!ok.includes(reply.code)) throw new SmtpError(reply.code, reply.text);
  };
  try {
    await step(null, [220]);
    await step("EHLO local-mail-api", [250]);
    await step(`MAIL FROM:<${parseMailbox(email.from)!.address}>`, [250]);
    for (const recipient of email.to) await step(`RCPT TO:<${recipient}>`, [250, 251]);
    await step("DATA", [354]);
    await step(`${message}\r\n.`, [250]);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const error = (statusCode: number, name: string, message: string) => ({ statusCode, name, message });
const digest = (value: string) => createHash("sha256").update(value).digest();

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createMailApi(options: { apiKey: string; smtp: Smtp; now?: () => number }): Server {
  const now = options.now ?? Date.now;
  const expected = digest(`Bearer ${options.apiKey}`);
  const keys = new Map<string, Stored>();

  return createServer(async (req, res) => {
    if (req.url !== "/emails") return send(res, 404, error(404, "not_found", "Only POST /emails is available"));
    if (req.method !== "POST") return send(res, 405, error(405, "method_not_allowed", "Use POST"));
    const auth = req.headers.authorization;
    if (!auth) return send(res, 401, error(401, "missing_api_key", "Missing API key"));
    if (!timingSafeEqual(digest(auth), expected)) return send(res, 403, error(403, "invalid_api_key", "API key is invalid"));

    const raw = await readBody(req);
    if (raw === null) return send(res, 413, error(413, "validation_error", "Body too large"));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return send(res, 422, error(422, "validation_error", "Body is not valid JSON"));
    }
    const email = parseEmail(parsed);
    if (typeof email === "string") return send(res, 422, error(422, "validation_error", email));

    const key = req.headers["idempotency-key"];
    if (Array.isArray(key) || (key !== undefined && (key.length === 0 || key.length > 256))) {
      return send(res, 400, error(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 256 characters"));
    }
    for (const [k, stored] of keys) if (stored.expiresAt <= now()) keys.delete(k);
    const fingerprint = createHash("sha256").update(JSON.stringify(email)).digest("hex");
    if (key) {
      const stored = keys.get(key);
      if (stored && stored.fingerprint !== fingerprint) {
        return send(res, 409, error(409, "invalid_idempotent_request", "Same Idempotency-Key with a different payload"));
      }
      if (stored && !stored.response) {
        return send(res, 409, error(409, "concurrent_idempotent_requests", "A request with this key is in progress"));
      }
      if (stored?.response) return send(res, stored.response.status, stored.response.body);
      keys.set(key, { fingerprint, expiresAt: now() + IDEMPOTENCY_TTL_MS });
    }

    const id = randomUUID();
    try {
      await sendSmtp(options.smtp, email, buildMessage(email, `${id}@lendloop.local`, new Date(now())));
    } catch (cause) {
      if (key) keys.delete(key); // only a success is remembered, so a retry can still send
      const message = cause instanceof Error ? cause.message : "SMTP failure";
      console.log(`local-mail-api: send failed: ${message.replace(/[^\s@<>]+@[^\s@<>]+/g, "[email]")}`);
      return send(res, 502, error(502, "smtp_error", message));
    }
    const response = { status: 200, body: { id } };
    if (key) keys.set(key, { fingerprint, expiresAt: now() + IDEMPOTENCY_TTL_MS, response });
    console.log(`local-mail-api: sent ${id} to ${email.to.length} recipient(s)`);
    return send(res, response.status, response.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.MAIL_API_KEY;
  if (!apiKey) {
    console.error("local-mail-api: MAIL_API_KEY is required (run pnpm setup:local)");
    process.exit(1);
  }
  const smtp = { host: process.env.SMTP_HOST ?? "mailpit", port: Number(process.env.SMTP_PORT ?? 1025) };
  const port = Number(process.env.PORT ?? 8080);
  createMailApi({ apiKey, smtp }).listen(port, () => console.log(`local-mail-api: listening on :${port}`));
}
