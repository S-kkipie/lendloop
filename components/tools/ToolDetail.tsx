"use client";

import { ArrowClockwiseIcon, ArrowLeftIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryLabel } from "@/lib/categories";
import { CONDITIONS, conditionLabel } from "@/lib/conditions";
import { isNotFound, messageForError } from "@/lib/convexErrors";
import { dayCount, formatRange } from "@/lib/format";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { BookingPanel } from "./BookingPanel";
import { CategoryIcon } from "./CategoryIcon";
import { OwnerPanel } from "./OwnerPanel";
import { TrustedBadge } from "./TrustedBadge";

function BackToBrowse() {
  return (
    <Link
      href="/tools"
      className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-[color] duration-(--dur-row) hover:text-foreground"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      Browse
    </Link>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const twoColumns = "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_auto] xl:gap-10";

export function ToolDetailSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading tool
      </span>
      <div aria-hidden="true" className={twoColumns}>
        <div className="grid gap-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-6 w-24 rounded-md" />
          <div className="mt-2 divide-y divide-border border-y border-border">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-6 py-3.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-96 w-full rounded-xl border border-border bg-card xl:w-[35.5rem]" />
      </div>
    </div>
  );
}

function LoadProblem({ error, reset }: { error: unknown; reset: () => void }) {
  const missing = isNotFound(error);
  return (
    <div className="grid gap-4">
      <BackToBrowse />
      <div role="alert" className="grid max-w-md gap-2 rounded-xl border border-border bg-card p-5">
        <h1 className="text-base font-semibold tracking-title">
          {missing ? "This tool isn't available" : "This tool didn't load"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {missing ? "It may have been removed by its owner, or the link is wrong." : messageForError(error)}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <ButtonLink size="sm" href="/tools">
            Browse tools
          </ButtonLink>
          {missing ? null : (
            <Button size="sm" variant="outline" onClick={reset}>
              <ArrowClockwiseIcon aria-hidden="true" /> Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolDetailContent({ toolId }: { toolId: Id<"tools"> }) {
  const tool = useQuery(api.tools.get, { toolId });
  if (tool === undefined) return <ToolDetailSkeleton />;

  const condition = CONDITIONS.find((c) => c.slug === tool.condition);
  const removed = tool.status === "removed";

  return (
    <div className="grid gap-6">
      <BackToBrowse />

      {removed ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-border bg-muted px-4 py-3.5">
          <ProhibitIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="grid gap-0.5 text-sm">
            <p className="font-medium">This listing was removed</p>
            <p className="text-muted-foreground">
              It no longer appears in Browse and can&apos;t be requested.
              {tool.removalReason ? <> Reason from the moderator: “{tool.removalReason}”</> : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className={twoColumns}>
        <article aria-labelledby="tool-name" className="grid min-w-0 content-start gap-5">
          <header className="grid gap-3">
            <h1 id="tool-name" className="text-3xl font-semibold tracking-title [overflow-wrap:anywhere]">
              {tool.name}
            </h1>
            {removed ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <AvailabilityBadge availability={tool.availability} />
              </div>
            )}
          </header>

          <dl className="divide-y divide-border border-y border-border">
            <Fact term="Category">
              <span className="inline-flex items-center gap-1.5">
                <CategoryIcon category={tool.category} aria-hidden="true" className="size-4 text-muted-foreground" />
                {categoryLabel(tool.category)}
              </span>
            </Fact>
            <Fact term="Condition">
              {conditionLabel(tool.condition)}
              {condition ? <span className="text-muted-foreground">. {condition.hint}</span> : null}
            </Fact>
            <Fact term="Lent by">
              {tool.isMine ? (
                "You"
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {tool.owner.displayName}
                  {tool.owner.isTrustedLender ? <TrustedBadge /> : null}
                </span>
              )}
            </Fact>
            <Fact term="Booked">
              {tool.bookedRanges.length === 0 ? (
                <span className="text-muted-foreground">No upcoming bookings</span>
              ) : (
                <ul className="grid gap-1">
                  {tool.bookedRanges.map((range) => (
                    <li key={range.startDate} className="font-mono text-[0.8125rem]">
                      {formatRange(range.startDate, range.endDate)}
                      <span className="text-muted-foreground"> · {dayCount(range.startDate, range.endDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Fact>
          </dl>

          <section aria-labelledby="about-title" className="grid gap-2">
            <h2 id="about-title" className="text-sm font-medium">
              About this tool
            </h2>
            <p className="max-w-[65ch] text-[0.9375rem] leading-relaxed whitespace-pre-line text-muted-foreground">
              {tool.description || "No description yet."}
            </p>
          </section>
        </article>

        {removed ? null : (
          // The booking panel is as wide as two calendar months; the owner's is a short list of actions.
          <aside className={`w-full min-w-0 ${tool.isMine ? "xl:w-[24rem]" : "xl:w-[35.5rem]"}`}>
            {tool.isMine ? (
              <OwnerPanel toolId={tool._id} toolName={tool.name} availability={tool.availability} />
            ) : (
              <BookingPanel
                toolId={tool._id}
                toolName={tool.name}
                ownerName={tool.owner.displayName}
                booked={tool.bookedRanges}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** One tool: what it is, who lends it, its bookings, and how to request it. */
export function ToolDetail({ toolId }: { toolId: string }) {
  return (
    <ErrorBoundary resetKey={toolId} fallback={(error, reset) => <LoadProblem error={error} reset={reset} />}>
      <ToolDetailContent toolId={toolId as Id<"tools">} />
    </ErrorBoundary>
  );
}
