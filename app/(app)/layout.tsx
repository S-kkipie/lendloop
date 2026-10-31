import { auth } from "@clerk/nextjs/server";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

// The shell is static and prerenders with every page; only this sign-in check
// reads the request, so it sits in its own Suspense boundary (Next 16 Cache
// Components: keep session reads out of a layout's top level). auth.protect()
// is a UX redirect for signed-out visitors; authorization is enforced in every
// Convex function, and the client gate (EnsureUser) waits for the user row.
// Instant-navigation validation renders without cookies, where this session
// check always redirects. Opt the group out here, and have every page in the
// group export `instant = false` too (otherwise the validator reports the page
// segment as dropped).
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <RequireSignIn />
      </Suspense>
      <AppShell>{children}</AppShell>
    </>
  );
}

async function RequireSignIn() {
  await auth.protect();
  return null;
}
