import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminConsole, AdminSkeleton } from "@/components/admin/AdminConsole";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  // The tab and filters live in the query string, read at request time.
  return (
    <Suspense fallback={<AdminSkeleton />}>
      <AdminConsole />
    </Suspense>
  );
}
