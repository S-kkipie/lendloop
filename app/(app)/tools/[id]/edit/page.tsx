import type { Metadata } from "next";
import { Suspense } from "react";
import { EditTool, EditToolSkeleton } from "@/components/tools/EditTool";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Edit listing" };

async function EditFromParams({ params }: { params: PageProps<"/tools/[id]/edit">["params"] }) {
  const { id } = await params;
  return <EditTool toolId={id} />;
}

export default function EditToolPage({ params }: PageProps<"/tools/[id]/edit">) {
  return (
    <Suspense fallback={<EditToolSkeleton />}>
      <EditFromParams params={params} />
    </Suspense>
  );
}
