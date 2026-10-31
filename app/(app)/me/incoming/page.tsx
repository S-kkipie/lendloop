import type { Metadata } from "next";
import { Suspense } from "react";
import { IncomingRequests, IncomingSkeleton } from "@/components/loans/IncomingRequests";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Incoming requests" };

export default function IncomingPage() {
  // The selected tab lives in ?tab=, read at request time.
  return (
    <Suspense fallback={<IncomingSkeleton />}>
      <IncomingRequests />
    </Suspense>
  );
}
