import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowseSkeleton, BrowseTools } from "@/components/tools/BrowseTools";

// Signed-in area: instant-navigation validation renders without cookies, where
// the group's sign-in check always redirects (see app/(app)/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Browse tools" };

export default function BrowsePage() {
  // Filters live in the URL; reading search params happens at request time.
  return (
    <Suspense fallback={<BrowseSkeleton />}>
      <BrowseTools />
    </Suspense>
  );
}
