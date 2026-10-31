"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isNotFound, messageForError } from "@/lib/convexErrors";
import { ToolForm } from "./ToolForm";

function Notice({ title, body, toolId }: { title: string; body: string; toolId?: string }) {
  return (
    <div role="alert" className="grid max-w-md gap-2 rounded-xl border border-border bg-card p-5">
      <h1 className="text-base font-semibold tracking-title">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="mt-1">
        <ButtonLink size="sm" variant="outline" href={toolId ? `/tools/${toolId}` : "/tools"}>
          {toolId ? "Back to the tool" : "Browse tools"}
        </ButtonLink>
      </div>
    </div>
  );
}

export function EditToolSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading listing
      </span>
      <div aria-hidden="true" className="grid gap-6">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="grid gap-6 rounded-xl border border-border bg-card p-6 lg:mr-[19rem]">
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid gap-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditToolContent({ toolId }: { toolId: Id<"tools"> }) {
  const tool = useQuery(api.tools.get, { toolId });
  if (tool === undefined) return <EditToolSkeleton />;
  if (!tool.isMine) {
    return <Notice title="Only the owner can edit this" body="You can still request it from its page." toolId={tool._id} />;
  }
  if (tool.status === "removed") {
    return <Notice title="This listing was removed" body="Removed listings can't be edited." toolId={tool._id} />;
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <Link
          href={`/tools/${tool._id}`}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-[color] duration-(--dur-row) hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          {tool.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-title">Edit listing</h1>
      </header>
      <ToolForm
        toolId={tool._id}
        initial={{
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
        }}
      />
    </div>
  );
}

export function EditTool({ toolId }: { toolId: string }) {
  return (
    <ErrorBoundary
      resetKey={toolId}
      fallback={(error) =>
        isNotFound(error) ? (
          <Notice title="This tool isn't available" body="It may have been removed, or the link is wrong." />
        ) : (
          <Notice title="This listing didn't load" body={messageForError(error)} />
        )
      }
    >
      <EditToolContent toolId={toolId as Id<"tools">} />
    </ErrorBoundary>
  );
}
