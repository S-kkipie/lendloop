// Security headers for every route, built from env so the same code serves the
// local stack (http://127.0.0.1:3210 Convex, Clerk dev instance) and production.
// Sources:
//   Clerk CSP guide: https://clerk.com/docs/guides/secure/best-practices/csp-headers
//   Next 16:         node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
//                    ("Without Nonces"; 'unsafe-eval' only in development)
// 'unsafe-inline' scripts are needed without nonces (Next's inline bootstrap);
// a nonce-based policy set in proxy.ts is the production follow-up
// (docs/production.md).
// Kept free of Next imports so next.config.ts and unit tests can load it.

export type HeaderEnv = {
  convexUrl?: string;
  clerkPublishableKey?: string;
  /** `next dev`: React needs eval for its dev-only stack reconstruction. */
  development: boolean;
  /** `next start` / Vercel: adds HSTS (browsers ignore it over plain http). */
  production: boolean;
};

/**
 * Clerk publishable keys are `pk_(test|live)_` + base64("<frontend api host>$").
 * Returns the host, or undefined for anything that does not decode to one.
 */
export function clerkFrontendApiHost(publishableKey: string | undefined): string | undefined {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? "");
  if (!match) return undefined;
  const decoded = Buffer.from(match[2], "base64").toString("utf8");
  if (!decoded.endsWith("$")) return undefined;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host.toLowerCase() : undefined;
}

/** Convex client URL -> the HTTP origin and the matching WebSocket origin it syncs over. */
export function convexOrigins(convexUrl: string | undefined): string[] {
  if (!convexUrl) return [];
  let url: URL;
  try {
    url = new URL(convexUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  const ws = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, `${ws}//${url.host}`];
}

export function contentSecurityPolicy(env: HeaderEnv): string {
  const clerkHost = clerkFrontendApiHost(env.clerkPublishableKey);
  const clerk = clerkHost ? [`https://${clerkHost}`] : [];
  const turnstile = "https://challenges.cloudflare.com";
  // Clerk's abuse and fraud protection; connect-src needs ":*" (non-443 ports).
  const protect = "https://*.protect.clerk.com";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(env.development ? ["'unsafe-eval'"] : []), ...clerk, turnstile, protect],
    "connect-src": [
      "'self'",
      ...convexOrigins(env.convexUrl),
      ...clerk,
      `${protect}:*`,
      // Clerk development instances report SDK telemetry from the browser.
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
    ],
    "img-src": ["'self'", "data:", "https://img.clerk.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'"],
    "frame-src": [turnstile, protect],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(env: HeaderEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    ...(env.production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
