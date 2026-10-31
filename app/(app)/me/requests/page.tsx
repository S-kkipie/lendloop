import type { Metadata } from "next";
import { Suspense } from "react";
import { MyRequests, MyRequestsSkeleton } from "@/components/loans/MyRequests";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "My requests" };

export default function MyRequestsPage() {
  // The selected tab lives in ?tab=, read at request time.
  return (
    <Suspense fallback={<MyRequestsSkeleton />}>
      <MyRequests />
    </Suspense>
  );
}
