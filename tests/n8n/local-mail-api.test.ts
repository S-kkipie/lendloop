// The local stand-in for Resend's email API: request validation, bearer auth,
// Resend's Idempotency-Key semantics, and the SMTP relay (against a fake SMTP
// server that records what it receives and can reject recipients like
// Mailpit's chaos mode does).
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildMessage, createMailApi, parseEmail, parseMailbox } from "../../n8n/local-mail-api";

const KEY = "local-test-key";
const EMAIL = { from: "LendLoop <no-reply@lendloop.local>", to: "ana@example.com", subject: "Hi", text: "Hello" };

type FakeSmtp = { server: Server; port: number; messages: string[]; rejectRecipients: boolean };

function fakeSmtp(): Promise<FakeSmtp> {
  const state = { messages: [] as string[], rejectRecipients: false };
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let data: string[] | null = null;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            state.messages.push(data.join("\r\n"));
            data = null;
            socket.write("250 queued\r\n");
          } else data.push(line);
        } else if (line.startsWith("EHLO")) socket.write("250-fake\r\n250 8BITMIME\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write(state.rejectRecipients ? "451 try later\r\n" : "250 ok\r\n");
        else if (line === "DATA") {
          data = [];
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(Object.assign(state, { server, port: (server.address() as AddressInfo).port })),
    ),
  );
}

let smtp: FakeSmtp;
let api: ReturnType<typeof createMailApi>;
let url: string;
let clock = Date.UTC(2026, 10, 1);

beforeEach(async () => {
  smtp = await fakeSmtp();
  api = createMailApi({ apiKey: KEY, smtp: { host: "127.0.0.1", port: smtp.port }, now: () => clock });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(api.address() as AddressInfo).port}/emails`;
});

afterEach(async () => {
  await new Promise((resolve) => api.close(resolve));
  await new Promise((resolve) => smtp.server.close(resolve));
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

describe("parsing", () => {
  test("mailboxes with and without a display name", () => {
    expect(parseMailbox("LendLoop <no-reply@lendloop.local>")).toEqual({ name: "LendLoop", address: "no-reply@lendloop.local" });
    expect(parseMailbox("ops@lendloop.local")).toEqual({ name: "", address: "ops@lendloop.local" });
    expect(parseMailbox("not an address")).toBeNull();
  });

  test("request bodies follow Resend's shape", () => {
    expect(parseEmail(EMAIL)).toEqual({ ...EMAIL, to: ["ana@example.com"] });
    expect(parseEmail({ ...EMAIL, to: [] })).toMatch(/`to`/);
    expect(parseEmail({ ...EMAIL, to: ["nope"] })).toMatch(/invalid address/);
    expect(parseEmail({ ...EMAIL, subject: "a\r\nBcc: x@y.z" })).toMatch(/line breaks/);
    expect(parseEmail({ ...EMAIL, text: undefined })).toMatch(/`text`/);
  });

  test("messages encode non-ASCII headers and carry a base64 body", () => {
    const message = buildMessage(
      { from: "LendLoop <no-reply@lendloop.local>", to: ["ana@example.com"], subject: "Joaquín wants your drill", text: "Hola\nAna" },
      "id@lendloop.local",
      new Date(clock),
    );
    expect(message).toContain('From: "LendLoop" <no-reply@lendloop.local>');
    expect(message).toContain(`Subject: =?UTF-8?B?${Buffer.from("Joaquín wants your drill").toString("base64")}?=`);
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message.split("\r\n\r\n")[1]).toBe(Buffer.from("Hola\r\nAna").toString("base64"));
  });
});

describe("POST /emails", () => {
  test("requires the bearer key", async () => {
    const missing = await fetch(url, { method: "POST", body: "{}" });
    expect(missing.status).toBe(401);
    expect((await post(EMAIL, { authorization: "Bearer wrong" })).status).toBe(403);
    expect(smtp.messages).toHaveLength(0);
  });

  test("rejects invalid bodies with 422", async () => {
    expect(await post({ ...EMAIL, from: "nobody" })).toMatchObject({ status: 422, body: { name: "validation_error" } });
  });

  test("relays a valid email over SMTP and returns its id", async () => {
    const res = await post(EMAIL);
    expect(res).toMatchObject({ status: 200, body: { id: expect.any(String) } });
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toContain("To: ana@example.com");
  });

  test("the same Idempotency-Key and body sends once and repeats the response", async () => {
    const first = await post(EMAIL, { "idempotency-key": "lendloop-evt_1" });
    const second = await post(EMAIL, { "idempotency-key": "lendloop-evt_1" });
    expect(second).toEqual(first);
    expect(smtp.messages).toHaveLength(1);
  });

  test("the same key with a different body is a conflict", async () => {
    await post(EMAIL, { "idempotency-key": "lendloop-evt_2" });
    const conflict = await post({ ...EMAIL, subject: "Other" }, { "idempotency-key": "lendloop-evt_2" });
    expect(conflict).toMatchObject({ status: 409, body: { name: "invalid_idempotent_request" } });
    expect(smtp.messages).toHaveLength(1);
  });

  test("keys expire after 24 hours", async () => {
    await post(EMAIL, { "idempotency-key": "lendloop-evt_3" });
    clock += 24 * 60 * 60 * 1000;
    await post(EMAIL, { "idempotency-key": "lendloop-evt_3" });
    expect(smtp.messages).toHaveLength(2);
  });

  test("an SMTP rejection is a 502 and is not remembered, so a retry can send", async () => {
    smtp.rejectRecipients = true;
    const failed = await post(EMAIL, { "idempotency-key": "lendloop-evt_4" });
    expect(failed).toMatchObject({ status: 502, body: { name: "smtp_error", message: "SMTP 451 try later" } });
    smtp.rejectRecipients = false;
    expect((await post(EMAIL, { "idempotency-key": "lendloop-evt_4" })).status).toBe(200);
    expect(smtp.messages).toHaveLength(1);
  });

  test("an SMTP server that drops the connection is a 502", async () => {
    const dropping = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => dropping.listen(0, "127.0.0.1", resolve));
    const relay = createMailApi({
      apiKey: KEY,
      smtp: { host: "127.0.0.1", port: (dropping.address() as AddressInfo).port },
      now: () => clock,
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const res = await fetch(`http://127.0.0.1:${(relay.address() as AddressInfo).port}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify(EMAIL),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ message: "SMTP connection closed" });
    await new Promise((resolve) => relay.close(resolve));
    await new Promise((resolve) => dropping.close(resolve));
  });
});
