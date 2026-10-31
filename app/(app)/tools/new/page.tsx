import type { Metadata } from "next";
import { ToolForm } from "@/components/tools/ToolForm";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "List a tool" };

export default function NewToolPage() {
  return (
    <div className="grid gap-6">
      <header className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-title">List a tool</h1>
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Neighbours see the name, category, condition and description, plus your first name and initial.
        </p>
      </header>
      <ToolForm />
    </div>
  );
}
