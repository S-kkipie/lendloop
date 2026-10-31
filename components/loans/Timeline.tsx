"use client";

import type { Icon } from "@phosphor-icons/react";
import { ArrowRightIcon, BellRingingIcon, EnvelopeSimpleIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { RelativeTime, useNow } from "@/components/shell/RelativeTime";
import { loanStatusView, type LoanStatus } from "@/lib/loanStatus";
import {
  isShownAsAutomation,
  nextStepCopy,
  notificationEntryCopy,
  reminderEntryCopy,
  statusEntryCopy,
  type EntryCopy,
  type NotificationEntry,
  type ReminderEntry,
  type StatusEntry,
  type TimelineContext,
} from "@/lib/timeline";
import type { NextStep } from "@/convex/model/loanMachine";
import { useArrivals } from "./useArrivals";

type Entry =
  | (StatusEntry & { at: number })
  | (NotificationEntry & { at: number; error?: string })
  | (ReminderEntry & { at: number });

interface TimelineProps {
  entries: readonly Entry[];
  nextStep: NextStep;
  loan: { startDate: string; endDate: string; overdue: boolean; message?: string };
  context: TimelineContext;
}

type Marker = { kind: "status"; icon: Icon } | { kind: "automation"; icon: Icon } | { kind: "next" };

function Dot({ marker }: { marker: Marker }) {
  if (marker.kind === "next") {
    return (
      <span className="grid size-7 place-items-center rounded-full border border-dashed border-input bg-background text-muted-foreground">
        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
      </span>
    );
  }
  const IconComponent = marker.icon;
  return marker.kind === "automation" ? (
    // Automation (email, reminders): cobalt-tinted dot, envelope or bell.
    <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-primary-ink">
      <IconComponent aria-hidden="true" className="size-3.5" />
    </span>
  ) : (
    // A status change: a solid ink-ringed dot with the status glyph.
    <span className="grid size-7 place-items-center rounded-full border border-border bg-card text-foreground">
      <IconComponent aria-hidden="true" weight="bold" className="size-3.5" />
    </span>
  );
}

function Item({
  marker,
  copy,
  meta,
  extra,
  rail,
  arriving,
  onArrived,
}: {
  marker: Marker;
  copy: EntryCopy;
  meta?: ReactNode;
  extra?: ReactNode;
  /** The line down to the next item: solid, dashed (towards the next step) or none. */
  rail: "solid" | "dashed" | "none";
  arriving?: boolean;
  onArrived?: () => void;
}) {
  const automation = marker.kind === "automation";
  return (
    <li
      className={cn("relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-6 last:pb-0", arriving && "row-arrive")}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onArrived?.();
      }}
    >
      {rail === "none" ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-8 bottom-1 left-[calc(0.875rem-0.5px)] w-0 border-l",
            rail === "dashed" ? "border-dashed border-input" : "border-border",
          )}
        />
      )}
      <Dot marker={marker} />
      <div className="grid min-w-0 content-start gap-0.5 pt-[3px]">
        <p
          className={cn(
            "text-sm leading-[1.375rem]",
            marker.kind === "status" && "font-medium",
            marker.kind === "next" && "text-muted-foreground",
            copy.failed && "text-danger-ink",
          )}
        >
          {automation ? <span className="sr-only">Automation: </span> : null}
          {marker.kind === "next" ? <span className="sr-only">Next step: </span> : null}
          {copy.title}
        </p>
        {copy.detail ? <p className="text-[0.8125rem] leading-5 text-muted-foreground">{copy.detail}</p> : null}
        {extra}
        {meta}
      </div>
    </li>
  );
}

function entryKey(entry: Entry, index: number, all: readonly Entry[]): string {
  if (entry.kind === "status") return `s:${entry.at}:${entry.action}`;
  if (entry.kind === "reminder") return `r:${entry.at}`;
  // A notification's time moves as it is queued, sent or retried: key it by
  // type, recipient and occurrence instead, so it never remounts.
  const nth = all
    .slice(0, index)
    .filter((e) => e.kind === "notification" && e.type === entry.type && e.recipient === entry.recipient).length;
  return `n:${entry.type}:${entry.recipient}:${nth}`;
}

/**
 * The loan's record as a vertical rail: status changes (ink dots), the
 * automation around them (cobalt-tinted dots: emails and reminders), and the
 * next expected step as a dashed entry. Live: new entries ease in.
 */
export function Timeline({ entries, nextStep, loan, context }: TimelineProps) {
  const now = useNow();
  const shown = entries.filter((entry) => entry.kind !== "status" || !isShownAsAutomation(entry));
  const keyed = shown.map((entry, index) => ({ entry, key: entryKey(entry, index, shown) }));
  const arrivals = useArrivals(keyed.map((item) => item.key));
  const next = nextStepCopy(nextStep, loan, context);

  return (
    <ol className="grid">
      {keyed.map(({ entry, key }, index) => {
        const last = index === keyed.length - 1;
        const rail = last ? (next ? "dashed" : "none") : "solid";
        const meta = <RelativeTime at={entry.at} now={now} />;
        const common = { rail, meta, arriving: arrivals.isArriving(key), onArrived: () => arrivals.settle(key) } as const;

        if (entry.kind === "status") {
          const view = entry.toStatus ? loanStatusView({ status: entry.toStatus as LoanStatus, overdue: false, daysOverdue: 0 }) : null;
          const copy = statusEntryCopy(entry, context);
          // The borrower's note travels with the request (the owner sees it).
          const message =
            entry.action === "loan.request" && loan.message ? (
              <p className="max-w-[65ch] text-[0.8125rem] leading-5 text-muted-foreground">
                <span className="sr-only">Message: </span>“{loan.message}”
              </p>
            ) : null;
          return (
            <Item
              key={key}
              marker={{ kind: "status", icon: view?.icon ?? PencilSimpleLineIcon }}
              copy={copy}
              extra={message}
              {...common}
            />
          );
        }
        if (entry.kind === "notification") {
          const copy = notificationEntryCopy(entry, context);
          // Admins also get the sanitized delivery error, while it still applies.
          const error = entry.error && copy.failed ? (
            <p className="font-mono text-xs leading-5 [overflow-wrap:anywhere] text-danger-ink">{entry.error}</p>
          ) : null;
          return (
            <Item key={key} marker={{ kind: "automation", icon: EnvelopeSimpleIcon }} copy={copy} extra={error} {...common} />
          );
        }
        return (
          <Item
            key={key}
            marker={{ kind: "automation", icon: BellRingingIcon }}
            copy={reminderEntryCopy(entry, context)}
            {...common}
          />
        );
      })}
      {next ? <Item key="next" marker={{ kind: "next" }} copy={next} rail="none" /> : null}
    </ol>
  );
}
