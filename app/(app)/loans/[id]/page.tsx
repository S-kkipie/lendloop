import type { Metadata } from "next";
import { Suspense } from "react";
import { LoanTimeline, LoanTimelineSkeleton } from "@/components/loans/LoanTimeline";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Loan" };

async function LoanFromParams({ params }: { params: PageProps<"/loans/[id]">["params"] }) {
  const { id } = await params;
  return <LoanTimeline loanId={id} />;
}

export default function LoanPage({ params }: PageProps<"/loans/[id]">) {
  return (
    <Suspense fallback={<LoanTimelineSkeleton />}>
      <LoanFromParams params={params} />
    </Suspense>
  );
}
