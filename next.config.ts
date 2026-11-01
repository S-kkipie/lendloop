import type { NextConfig } from "next";
import { securityHeaders } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // CSP and the other security headers on every route (see lib/securityHeaders.ts).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
          clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          development: process.env.NODE_ENV === "development",
          production: process.env.NODE_ENV === "production",
        }),
      },
    ];
  },
};

export default nextConfig;
