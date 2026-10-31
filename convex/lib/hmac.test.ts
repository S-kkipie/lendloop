import { describe, expect, test } from "vitest";
import vectors from "../../contracts/hmac-vectors.json";
import { canonicalString, parseSignatureHeader, sign, signatureHeader, verifySignature } from "./hmac";

const { secret, cases } = vectors;

describe("shared vectors (generated with node:crypto)", () => {
  test.each(cases)("$name", async (c) => {
    expect(await sign(secret, c.timestamp, c.method, c.path, c.body)).toBe(c.signature);
  });
});

test("canonical string binds timestamp, method and path", () => {
  expect(canonicalString("1", "post", "/x", "{}")).toBe("1.POST./x.{}");
});

test("parseSignatureHeader keeps only well-formed v1 values", () => {
  const good = "a".repeat(64);
  expect(parseSignatureHeader(`v1=${good}, v0=${good}, v1=zz`)).toEqual([good]);
  expect(parseSignatureHeader(null)).toEqual([]);
});

describe("verifySignature", () => {
  const c = cases[0];
  const nowMs = Number(c.timestamp) * 1000;
  const base = {
    secrets: [secret],
    timestamp: c.timestamp,
    signatureHeader: signatureHeader(c.signature),
    method: c.method,
    path: c.path,
    body: c.body,
    nowMs,
  };

  test("accepts a valid signature", async () => {
    expect(await verifySignature(base)).toEqual({ ok: true });
  });

  test("accepts the previous secret during rotation", async () => {
    expect(await verifySignature({ ...base, secrets: ["x".repeat(40), secret] })).toEqual({ ok: true });
  });

  test("rejects a tampered body, path or method", async () => {
    expect(await verifySignature({ ...base, body: c.body + " " })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifySignature({ ...base, path: "/n8n/other" })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifySignature({ ...base, method: "PUT" })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("rejects stale and future timestamps beyond 300 s", async () => {
    expect(await verifySignature({ ...base, nowMs: nowMs + 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, nowMs: nowMs - 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, nowMs: nowMs + 299_000 })).toEqual({ ok: true });
  });

  test("rejects missing headers and malformed timestamps", async () => {
    expect(await verifySignature({ ...base, signatureHeader: null })).toEqual({ ok: false, reason: "missing" });
    expect(await verifySignature({ ...base, timestamp: null })).toEqual({ ok: false, reason: "missing" });
    expect(await verifySignature({ ...base, timestamp: "17936208OO" })).toEqual({ ok: false, reason: "missing" });
  });

  test("rejects when no secret is configured", async () => {
    expect(await verifySignature({ ...base, secrets: [] })).toEqual({ ok: false, reason: "mismatch" });
  });
});
