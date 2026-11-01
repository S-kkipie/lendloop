import { describe, expect, test } from "vitest";
import { clerkFrontendApiHost, contentSecurityPolicy, convexOrigins, securityHeaders } from "./securityHeaders";

// A syntactically valid key for a made-up instance (not a real one).
const KEY = `pk_test_${Buffer.from("example-app-12.clerk.accounts.dev$").toString("base64")}`;
const LOCAL = { convexUrl: "http://127.0.0.1:3210", clerkPublishableKey: KEY, development: true, production: false };
const PROD = {
  convexUrl: "https://happy-otter-123.convex.cloud",
  clerkPublishableKey: KEY,
  development: false,
  production: true,
};

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );
}

describe("clerkFrontendApiHost", () => {
  test("decodes the Frontend API host from a publishable key", () => {
    expect(clerkFrontendApiHost(KEY)).toBe("example-app-12.clerk.accounts.dev");
    const live = `pk_live_${Buffer.from("clerk.example.com$").toString("base64")}`;
    expect(clerkFrontendApiHost(live)).toBe("clerk.example.com");
  });

  test.each([undefined, "", "pk_test_", "sk_test_abc", `pk_test_${Buffer.from("no-dollar.example.com").toString("base64")}`,
    `pk_test_${Buffer.from("bad host; script-src *$").toString("base64")}`])("rejects %o", (key) => {
    expect(clerkFrontendApiHost(key)).toBeUndefined();
  });
});

describe("convexOrigins", () => {
  test("local http deployment -> http and ws origins", () => {
    expect(convexOrigins("http://127.0.0.1:3210")).toEqual(["http://127.0.0.1:3210", "ws://127.0.0.1:3210"]);
  });
  test("cloud deployment -> https and wss origins, path dropped", () => {
    expect(convexOrigins("https://happy-otter-123.convex.cloud/")).toEqual([
      "https://happy-otter-123.convex.cloud",
      "wss://happy-otter-123.convex.cloud",
    ]);
  });
  test.each([undefined, "", "not a url", "javascript:alert(1)"])("ignores %o", (url) => {
    expect(convexOrigins(url)).toEqual([]);
  });
});

describe("contentSecurityPolicy", () => {
  test("production: Clerk, Turnstile and Convex allowed; nothing else external; no eval", () => {
    const d = directives(contentSecurityPolicy(PROD));
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://example-app-12.clerk.accounts.dev",
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
    ]);
    expect(d["connect-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://happy-otter-123.convex.cloud",
        "wss://happy-otter-123.convex.cloud",
        "https://example-app-12.clerk.accounts.dev",
        "https://*.protect.clerk.com:*",
      ]),
    );
    expect(d["img-src"]).toEqual(["'self'", "data:", "https://img.clerk.com"]);
    expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["font-src"]).toEqual(["'self'"]);
    expect(d["frame-src"]).toEqual(["https://challenges.cloudflare.com", "https://*.protect.clerk.com"]);
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
  });

  test("development adds 'unsafe-eval' (React dev tooling) and the local Convex origins", () => {
    const d = directives(contentSecurityPolicy(LOCAL));
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["connect-src"]).toEqual(expect.arrayContaining(["http://127.0.0.1:3210", "ws://127.0.0.1:3210"]));
  });

  test("without config the policy is still valid and only allows first-party plus fixed Clerk hosts", () => {
    const d = directives(contentSecurityPolicy({ development: false, production: true }));
    expect(d["connect-src"].filter((s) => !s.includes("clerk") && s !== "'self'")).toEqual([]);
  });
});

describe("securityHeaders", () => {
  const byKey = (env: typeof PROD) => Object.fromEntries(securityHeaders(env).map((h) => [h.key, h.value]));

  test("production set", () => {
    expect(byKey(PROD)).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "X-Frame-Options": "DENY",
    });
  });

  test("HSTS only in production", () => {
    expect(byKey(LOCAL)).not.toHaveProperty("Strict-Transport-Security");
  });
});
