"use client";

import { ArrowRightIcon, UserIcon, WarningIcon } from "@phosphor-icons/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import { LedgerRow } from "@/components/shell/LedgerList";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayCount, firstName, formatDay, formatRange } from "@/lib/format";
import { closeReasonText } from "@/lib/loanStatus";
import { LoanActions, type OverlapFacts } from "./LoanActions";
import { StatusBadge } from "./StatusBadge";

export type LoanRowData = FunctionReturnType<typeof api.loans.myRequests>[number] & { conflicts?: number };

/** Column template shared by the loan lists (xl and up): tool, dates, status, actions. */
export const LOAN_COLUMNS = "xl:grid-cols-[minmax(0,1fr)_max-content_max-content_max-content]";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The muted line under a row: why it matters right now. */
function Note({ tone = "muted", children }: { tone?: "muted" | "warn" | "danger"; children: ReactNode }) {
  const color = tone === "warn" ? "text-warn-ink" : tone === "danger" ? "text-danger-ink" : "text-muted-foreground";
  return (
    <p className={`flex items-start gap-1.5 text-[0.8125rem] leading-5 ${color}`}>
      {tone === "muted" ? null : <WarningIcon aria-hidden="true" weight="bold" className="mt-[3px] size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/** The notes under a loan: the borrower's message (owner only), overlap, overdue, why it closed. */
export function loanNotes(
  loan: LoanRowData,
  viewer: "owner" | "borrower" | "admin",
  overlap?: OverlapFacts,
  { includeMessage = true }: { includeMessage?: boolean } = {},
): ReactNode[] {
  const notes: ReactNode[] = [];
  if (includeMessage && viewer === "owner" && loan.message) {
    notes.push(
      <p key="message" className="line-clamp-3 max-w-[65ch] text-[0.8125rem] leading-5 text-muted-foreground">
        <span className="sr-only">Message: </span>“{loan.message}”
      </p>,
    );
  }
  if (loan.status === "pending" && viewer === "owner") {
    if (overlap?.booked) {
      notes.push(
        <Note key="booked" tone="warn">
          Some of these days are already booked. Decline it, or cancel the other booking first.
        </Note>,
      );
    } else if ((loan.conflicts ?? 0) > 0) {
      const others = overlap?.pending ?? loan.conflicts ?? 0;
      notes.push(
        <Note key="conflicts" tone="warn">
          Overlaps {plural(others, "other request")}. Approving declines {others === 1 ? "it" : "them"}.
        </Note>,
      );
    }
  }
  if (loan.overdue) {
    notes.push(
      viewer === "borrower" ? (
        <Note key="overdue" tone="danger">
          Please arrange the return with {firstName(loan.owner.displayName)}.
        </Note>
      ) : (
        <Note key="overdue" tone="danger">
          Was due back {formatDay(loan.endDate)}. {firstName(loan.borrower.displayName)} gets a daily email reminder.
        </Note>
      ),
    );
  }
  const reason = loan.status === "returned" ? null : closeReasonText(loan.closeReason);
  if (reason) notes.push(<Note key="reason">{reason}.</Note>);
  return notes;
}

interface LoanRowProps {
  loan: LoanRowData;
  /** Who is looking: the tool's owner (Incoming) or the borrower (My requests). */
  viewer: "owner" | "borrower";
  overlap?: OverlapFacts;
  arriving?: boolean;
  onArrived?: () => void;
}

/**
 * One loan in a list. Stacked below xl (tool and status, person, dates,
 * notes, actions); a table row from xl up. The tool name opens the timeline.
 */
export function LoanRow({ loan, viewer, overlap, arriving, onArrived }: LoanRowProps) {
  const nameId = useId();
  const person = viewer === "owner" ? loan.borrower.displayName : loan.owner.displayName;
  const notes = loanNotes(loan, viewer, overlap);

  return (
    <LedgerRow arriving={arriving} onArrived={onArrived} aria-labelledby={nameId}>
      <div className="col-start-1 row-start-1 grid min-w-0 content-start">
        <Link
          id={nameId}
          href={`/loans/${loan._id}`}
          className="w-fit max-w-full rounded-sm text-[0.9375rem] leading-6 font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline"
        >
          {loan.tool.name}
        </Link>
        <p className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-5 text-muted-foreground">
          <UserIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only">{viewer === "owner" ? "Borrower:" : "Lender:"} </span>
          <span className="truncate">{person}</span>
        </p>
      </div>

      <p className="col-span-2 row-start-2 mt-1 font-mono text-[0.8125rem] leading-6 whitespace-nowrap xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:mt-0">
        {formatRange(loan.startDate, loan.endDate)}
        <span className="text-muted-foreground"> · {dayCount(loan.startDate, loan.endDate)}</span>
      </p>

      <div className="col-start-2 row-start-1 flex justify-self-end xl:col-start-3 xl:justify-self-start">
        <StatusBadge loan={loan} />
      </div>

      {notes.length > 0 ? (
        <div className="col-span-2 row-start-3 mt-2 grid gap-1.5 xl:col-span-3 xl:col-start-1 xl:row-start-2">{notes}</div>
      ) : null}

      <LoanActions
        loan={loan}
        viewer={viewer}
        overlap={overlap}
        className="col-span-2 row-start-4 mt-3 xl:col-span-1 xl:col-start-4 xl:row-span-2 xl:row-start-1 xl:-my-1 xl:justify-self-end xl:self-start"
        trailing={
          viewer === "borrower" ? (
            <ButtonLink
              data-row-action=""
              href={`/loans/${loan._id}`}
              size="sm"
              variant="ghost"
              className="flex-1 sm:flex-none"
            >
              View<span className="sr-only"> {loan.tool.name}</span>
              <ArrowRightIcon aria-hidden="true" />
            </ButtonLink>
          ) : null
        }
      />
    </LedgerRow>
  );
}

/** A placeholder shaped like LoanRow. */
export function LoanRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3.5 xl:col-span-full xl:grid-cols-subgrid xl:gap-x-6"
    >
      <div className="grid gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="col-span-2 row-start-2 h-3.5 w-40 xl:col-span-1 xl:col-start-2 xl:row-start-1" />
      <Skeleton className="col-start-2 row-start-1 h-6 w-20 rounded-md xl:col-start-3" />
      <Skeleton className="hidden h-8 w-40 rounded-lg xl:col-start-4 xl:row-start-1 xl:block" />
    </div>
  );
}
