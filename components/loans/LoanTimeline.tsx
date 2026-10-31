"use client";

import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isNotFound, messageForError } from "@/lib/convexErrors";
import { dayCount, formatRange } from "@/lib/format";
import type { LoanStatus } from "@/lib/loanStatus";
import { LoanActions } from "./LoanActions";
import { loanNotes } from "./LoanRow";
import { overlapFacts } from "./overlap";
import { StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";

const BACK = {
  owner: { href: "/me/incoming", label: "Incoming" },
  borrower: { href: "/me/requests", label: "My requests" },
  admin: { href: "/tools", label: "Browse" },
} as const;

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-[color] duration-(--dur-row) hover:text-foreground"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      {label}
    </Link>
  );
}

export function LoanTimelineSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the loan
      </span>
      <div aria-hidden="true" className="grid gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-6 w-24 rounded-md" />
          <Skeleton className="h-6 w-44" />
        </div>
      </div>
      <div aria-hidden="true" className="grid max-w-2xl gap-6">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="grid gap-2 pt-1">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadProblem({ error, reset }: { error: unknown; reset: () => void }) {
  const missing = isNotFound(error);
  return (
    <div role="alert" className="grid max-w-md gap-2 rounded-xl border border-border bg-card p-5">
      <h1 className="text-base font-semibold tracking-title">
        {missing ? "This loan doesn't exist or isn't yours." : "This loan didn't load"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {missing
          ? "Only the lender and the borrower can see a loan. Check the link, or find it in your lists."
          : messageForError(error)}
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {missing ? (
          <>
            <ButtonLink size="sm" href="/me/requests">
              My requests
            </ButtonLink>
            <ButtonLink size="sm" variant="outline" href="/me/incoming">
              Incoming
            </ButtonLink>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={reset}>
            <ArrowClockwiseIcon aria-hidden="true" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

function LoanTimelineContent({ loanId }: { loanId: Id<"loans"> }) {
  const data = useQuery(api.loans.timeline, { loanId });
  const viewer = data?.viewer;
  // The owner's other requests tell whether approving this one declines any.
  const incoming = useQuery(api.loans.incoming, viewer === "owner" && data?.loan.status === "pending" ? {} : "skip");
  // The badge fades through a short blur when the status changes live, not on first paint.
  const [firstStatus, setFirstStatus] = useState<LoanStatus>();
  if (data && firstStatus === undefined) setFirstStatus(data.loan.status);

  if (data === undefined || viewer === undefined) return <LoanTimelineSkeleton />;
  const { loan } = data;

  const self = incoming?.find((other) => other._id === loan._id);
  const actionable = { ...loan, conflicts: self?.conflicts };
  const overlap = self && incoming ? overlapFacts(self, incoming) : undefined;
  const notes = loanNotes(loan, viewer, overlap, { includeMessage: false });
  const counterpart =
    viewer === "owner"
      ? `Borrowed by ${loan.borrower.displayName}`
      : viewer === "borrower"
        ? `Lent by ${loan.owner.displayName}`
        : `${loan.owner.displayName} lends to ${loan.borrower.displayName}`;
  const changed = firstStatus !== undefined && firstStatus !== loan.status;
  // Approving may decline overlapping requests: wait for those facts before offering it.
  const overlapPending = viewer === "owner" && loan.status === "pending" && incoming === undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <header className="grid gap-4">
        <BackLink {...BACK[viewer]} />
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="grid min-w-0 gap-3">
            <h1 className="text-3xl font-semibold tracking-title [overflow-wrap:anywhere]">
              <Link
                href={`/tools/${loan.tool._id}`}
                className="rounded-sm underline-offset-[6px] decoration-2 hover:underline"
              >
                {loan.tool.name}
              </Link>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span key={loan.status} className={changed ? "status-swap inline-flex" : "inline-flex"}>
                <StatusBadge loan={loan} />
              </span>
              <span className="font-mono text-[0.8125rem]">
                {formatRange(loan.startDate, loan.endDate)}
                <span className="text-muted-foreground"> · {dayCount(loan.startDate, loan.endDate)}</span>
              </span>
              <span className="text-muted-foreground">{counterpart}</span>
            </div>
            {notes.length > 0 ? <div className="grid gap-1.5">{notes}</div> : null}
          </div>
          {viewer === "admin" ? null : overlapPending ? (
            <Skeleton aria-hidden="true" className="h-8 w-44 rounded-lg" />
          ) : (
            <LoanActions loan={actionable} viewer={viewer} overlap={overlap} className="w-full sm:w-auto" />
          )}
        </div>
      </header>

      <section aria-labelledby="activity-title" className="grid max-w-2xl gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="activity-title" className="text-base font-semibold tracking-title">
            Activity
          </h2>
          {/* Legend: the two kinds of entry, so the cobalt dots read as automation. */}
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full border border-foreground/40 bg-card" />
              Status change
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-primary-ink/70" />
              Email or reminder, sent automatically
            </li>
          </ul>
        </div>
        <Timeline
          entries={data.entries}
          nextStep={data.nextStep}
          loan={loan}
          context={{
            viewer,
            owner: loan.owner.displayName,
            borrower: loan.borrower.displayName,
            toolName: loan.tool.name,
            endDate: loan.endDate,
          }}
        />
      </section>

    </div>
  );
}

/** One loan from request to return, with the automation around it. */
export function LoanTimeline({ loanId }: { loanId: string }) {
  return (
    <ErrorBoundary resetKey={loanId} fallback={(error, reset) => <LoadProblem error={error} reset={reset} />}>
      <LoanTimelineContent loanId={loanId as Id<"loans">} />
    </ErrorBoundary>
  );
}
