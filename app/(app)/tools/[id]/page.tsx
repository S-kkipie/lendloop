import type { Metadata } from "next";
import { Suspense } from "react";
import { ToolDetail, ToolDetailSkeleton } from "@/components/tools/ToolDetail";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Tool" };

async function ToolFromParams({ params }: { params: PageProps<"/tools/[id]">["params"] }) {
  const { id } = await params;
  return <ToolDetail toolId={id} />;
}

export default function ToolPage({ params }: PageProps<"/tools/[id]">) {
  return (
    <Suspense fallback={<ToolDetailSkeleton />}>
      <ToolFromParams params={params} />
    </Suspense>
  );
}
