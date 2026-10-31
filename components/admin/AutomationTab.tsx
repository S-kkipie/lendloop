"use client";

import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  WarningCircleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { cn } from "cn";
import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OUTBOX_STATUSES } from "@/convex/lib/validators";
import { keepFocusNear } from "@/components/loans/LoanActions";
import { useArrivals } from "@/components/loans/useArrivals";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerCell, LedgerList } from "@/components/shell/LedgerList";
import { RelativeTime, useNow } from "@/components/shell/RelativeTime";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  countText,
  deliveryExplainer,
  EVENT_LABEL,
  HEARTBEAT_THRESHOLD,
  PROBLEM_LABEL,
  REMINDER_SCHEDULE,
} from "@/lib/admin";
import { messageForError } from "@/lib/convexErrors";
import { formatTimestamp, relativeTime } from "@/lib/format";
import { AdminRow, AdminSection, plural, ShortId } from "./shared";

type Health = FunctionReturnType<typeof api.admin.automationHealth>;
type Problem = Health["problems"][number];
type AutomationError = Health["errors"][number];

const PROBLEM_HEADS = ["Notification", "Problem", "Tries", "Last error", "Queued", "Actions"] as const;
const PROBLEM_COLUMNS =
  "xl:grid-cols-[minmax(0,1fr)_max-content_max-content_minmax(0,1fr)_max-content_max-content]";
const ERROR_HEADS = ["Workflow", "Execution", "Message", "Reported", "Actions"] as const;
const ERROR_COLUMNS = "xl:grid-cols-[max-content_max-content_minmax(0,1fr)_max-content_max-content]";

function ProblemLabel({ problem }: { problem: Problem }) {
  const Icon = problem.status === "dead" ? WarningOctagonIcon : WarningCircleIcon;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap text-danger-ink">
      <Icon aria-hidden="true" weight="fill" className="size-3.5 shrink-0" />
      {PROBLEM_LABEL[problem.status] ?? problem.status}
    </span>
  );
}

function ReplayButton({ problem, now }: { problem: Problem; now: number }) {
  const replay = useMutation(api.admin.replayEvent);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = EVENT_LABEL[problem.type];

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await replay({ eventId: problem._id as Id<"outboxEvents"> });
      setConfirming(false);
      toast.success("Queued again", {
        description: `A new “${label}” email is on its way to n8n. This entry stays here for the record.`,
      });
    } catch (error) {
      toast.error("It wasn't replayed", { description: messageForError(error) });
    } finally {
      setBusy(false);
    }
  }

  const replayed = problem.replayedAt !== null;
  const button = (
    <Button data-row-action="" size="sm" variant={replayed ? "outline" : "default"} aria-busy={busy || undefined}>
      <ArrowCounterClockwiseIcon aria-hidden="true" />
      {replayed ? "Replay again" : "Replay"}
      <span className="sr-only">
        {" "}
        the {label} notification{problem.loanId ? ` for loan ending ${problem.loanId.slice(-6)}` : ""}
      </span>
    </Button>
  );

  // One tree for both states, so the button keeps keyboard focus when it turns
  // into "Replay again". The first replay runs at once; a second one asks
  // first, because each replay is a new event that n8n does not dedupe.
  return (
    <AlertDialog
      open={confirming}
      onOpenChange={(next) => {
        if (busy) return;
        if (next && !replayed) void run();
        else setConfirming(next);
      }}
    >
      <AlertDialogTrigger render={button} />
      <AlertDialogContent size="sm" initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Replay this again?</AlertDialogTitle>
          <AlertDialogDescription>
            It was replayed {relativeTime(problem.replayedAt ?? now, now)}. If that replay got through, the recipient gets the
            email twice. Check the loan&apos;s timeline first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>
            Don&apos;t replay
          </AlertDialogCancel>
          <Button onClick={run} aria-busy={busy || undefined}>
            {busy ? "Replaying…" : "Replay again"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProblemRow({
  problem,
  now,
  arriving,
  onArrived,
}: {
  problem: Problem;
  now: number;
  arriving: boolean;
  onArrived: () => void;
}) {
  const nameId = useId();
  const replayed =
    problem.replayedAt === null ? null : (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CheckIcon aria-hidden="true" weight="bold" className="size-3 shrink-0 text-ok-ink" />
        Replayed {relativeTime(problem.replayedAt, now)}
      </span>
    );
  const error = problem.lastError ? (
    <p className="font-mono text-xs leading-5 [overflow-wrap:anywhere] text-danger-ink">{problem.lastError}</p>
  ) : (
    <p className="text-xs text-muted-foreground">No error recorded</p>
  );

  return (
    <AdminRow arriving={arriving} onArrived={onArrived} aria-labelledby={nameId} className="items-start xl:items-center">
      <LedgerCell className="col-start-1 row-start-1 grid content-start gap-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={nameId} className="text-sm leading-6 font-medium">
            {EVENT_LABEL[problem.type]}
          </span>
          {problem.replayOf ? <Badge variant="outline">Replay</Badge> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs leading-5 text-muted-foreground">
          <span>{problem.type}</span>
          {problem.loanId ? (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={`/loans/${problem.loanId}`}
                className="rounded-sm text-primary-ink underline-offset-4 hover:underline"
              >
                Loan <ShortId id={problem.loanId} className="text-primary-ink" />
              </Link>
            </>
          ) : null}
        </p>
        {/* Stacked below xl: the problem, then the error, then when. */}
        <div className="mt-1.5 grid gap-1 xl:hidden">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProblemLabel problem={problem} />
            <span className="font-mono text-xs text-muted-foreground">
              {plural(problem.attempts, "try", "tries")}
            </span>
            <span className="text-xs text-muted-foreground">
              queued <RelativeTime at={problem.at} now={now} focusable={false} />
            </span>
          </p>
          {error}
          {replayed}
        </div>
      </LedgerCell>
      <LedgerCell className="hidden xl:block">
        <ProblemLabel problem={problem} />
      </LedgerCell>
      <LedgerCell className="hidden font-mono text-xs xl:block">
        {problem.attempts}
        <span className="sr-only"> {problem.attempts === 1 ? "try" : "tries"}</span>
      </LedgerCell>
      <LedgerCell className="hidden xl:block">{error}</LedgerCell>
      <LedgerCell className="hidden xl:block">
        <RelativeTime at={problem.at} now={now} focusable={false} />
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 grid justify-items-end gap-1 xl:col-start-auto xl:row-start-auto">
        <ReplayButton problem={problem} now={now} />
        <span className="hidden xl:inline">{replayed}</span>
      </LedgerCell>
    </AdminRow>
  );
}

function ResolveButton({ error }: { error: AutomationError }) {
  const resolve = useMutation(api.admin.resolveError);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      data-row-action=""
      size="sm"
      variant="outline"
      aria-busy={busy || undefined}
      onClick={async (event) => {
        if (busy) return;
        const origin = event.currentTarget;
        setBusy(true);
        try {
          await resolve({ errorId: error._id as Id<"automationErrors"> });
          keepFocusNear(origin);
          toast.success("Marked resolved", { description: "It leaves this list and stays in the audit log." });
        } catch (caught) {
          toast.error("It wasn't resolved", { description: messageForError(caught) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <CheckIcon aria-hidden="true" />
      Resolve<span className="sr-only"> the {error.workflow} error from execution {error.executionId}</span>
    </Button>
  );
}

function ErrorRow({
  error,
  now,
  arriving,
  onArrived,
}: {
  error: AutomationError;
  now: number;
  arriving: boolean;
  onArrived: () => void;
}) {
  const nameId = useId();
  return (
    <AdminRow arriving={arriving} onArrived={onArrived} aria-labelledby={nameId} className="items-start xl:items-center">
      <LedgerCell className="col-start-1 row-start-1 grid content-start gap-0.5">
        <span id={nameId} className="font-mono text-[0.8125rem] leading-6 font-medium">
          {error.workflow}
        </span>
        <span className="text-xs leading-5 text-muted-foreground">{error.node ? `at “${error.node}”` : "Node not reported"}</span>
        <div className="mt-1.5 grid gap-1 xl:hidden">
          <p className="text-[0.8125rem] leading-5 [overflow-wrap:anywhere]">{error.message}</p>
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
            <span className="[overflow-wrap:anywhere]">Execution {error.executionId}</span>
            <span className="font-sans">
              reported <RelativeTime at={error.at} now={now} focusable={false} />
            </span>
          </p>
        </div>
      </LedgerCell>
      <LedgerCell className="hidden font-mono text-xs xl:block">{error.executionId}</LedgerCell>
      <LedgerCell className="hidden text-[0.8125rem] leading-5 [overflow-wrap:anywhere] xl:block">{error.message}</LedgerCell>
      <LedgerCell className="hidden xl:block">
        <RelativeTime at={error.at} now={now} focusable={false} />
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 flex justify-end xl:col-start-auto xl:row-start-auto">
        <ResolveButton error={error} />
      </LedgerCell>
    </AdminRow>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[0.8125rem] text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-[0.8125rem]">{children}</dd>
    </div>
  );
}

/**
 * The automation around loans: notifications that never reached n8n (dead
 * letters) or never left it (failed sends), errors n8n reported, and whether
 * the daily reminder workflow still checks in.
 */
export function AutomationTab({ health }: { health: Health }) {
  const now = useNow();
  const problemArrivals = useArrivals(health.problems.map((p) => p._id));
  const errorArrivals = useArrivals(health.errors.map((e) => e._id));
  const beat = health.heartbeat;
  const counts = health.counts;

  return (
    <div className="grid gap-10">
      <AdminSection id="problems-title" title="Delivery problems" description={deliveryExplainer()}>
        {health.problems.length === 0 ? (
          <EmptyState
            icon={CheckCircleIcon}
            title="Nothing stuck"
            body="Every notification reached n8n and every email went out. Dead letters and failed sends show up here."
          />
        ) : (
          <LedgerList label="Delivery problems" heads={PROBLEM_HEADS} columns={PROBLEM_COLUMNS} semantics="table">
            {health.problems.map((problem) => (
              <ProblemRow
                key={problem._id}
                problem={problem}
                now={now}
                arriving={problemArrivals.isArriving(problem._id)}
                onArrived={() => problemArrivals.settle(problem._id)}
              />
            ))}
          </LedgerList>
        )}
      </AdminSection>

      <AdminSection
        id="errors-title"
        title="Unresolved errors"
        description="Failures n8n reports from inside a workflow, such as an email the mail server refused. n8n strips email addresses and cuts the message before it reports."
      >
        {health.errors.length === 0 ? (
          <EmptyState
            icon={CheckCircleIcon}
            title="No open errors"
            body="When a workflow fails, its error lands here until someone marks it resolved."
          />
        ) : (
          <LedgerList label="Unresolved errors" heads={ERROR_HEADS} columns={ERROR_COLUMNS} semantics="table">
            {health.errors.map((error) => (
              <ErrorRow
                key={error._id}
                error={error}
                now={now}
                arriving={errorArrivals.isArriving(error._id)}
                onArrived={() => errorArrivals.settle(error._id)}
              />
            ))}
          </LedgerList>
        )}
      </AdminSection>

      <AdminSection
        id="heartbeat"
        title="Reminders and outbox"
        description="The reminder workflow checks in with LendLoop every time it runs. An hourly check raises the alarm when it goes quiet."
      >
        <dl className="divide-y divide-border rounded-xl border border-border bg-card">
          <Fact term="Reminder workflow">
            <span className="font-mono text-xs">overdue-reminders</span>
            <span className="text-muted-foreground"> · {REMINDER_SCHEDULE}</span>
          </Fact>
          <Fact term="Last check-in">
            {beat.lastCheckInAt === null ? (
              <span className="font-medium text-danger-ink">Never</span>
            ) : (
              <span className={cn(beat.stale && "font-medium text-danger-ink")}>
                <span className="font-mono text-xs">{formatTimestamp(beat.lastCheckInAt)}</span>
                <span className={cn(!beat.stale && "text-muted-foreground")}>
                  {" "}
                  · {relativeTime(beat.lastCheckInAt, now)}
                  {beat.stale ? ", stale" : ""}
                </span>
              </span>
            )}
          </Fact>
          <Fact term="Alarm after">{HEARTBEAT_THRESHOLD} without a check-in</Fact>
          <Fact term="Reminders, last 24 h">
            <span className="font-mono text-xs">{health.reminders24h.sent}</span> sent ·{" "}
            <span className={cn("font-mono text-xs", health.reminders24h.failed > 0 && "text-danger-ink")}>
              {health.reminders24h.failed}
            </span>{" "}
            <span className={cn(health.reminders24h.failed > 0 && "text-danger-ink")}>failed</span>
          </Fact>
          <Fact term="Notifications by status">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
              {OUTBOX_STATUSES.map((status) => (
                <li
                  key={status}
                  className={cn(
                    (status === "dead" || status === "failed") && (counts[status] ?? 0) > 0 && "text-danger-ink",
                    (counts[status] ?? 0) === 0 && "text-muted-foreground",
                  )}
                >
                  {status} {countText(counts[status] ?? 0)}
                </li>
              ))}
            </ul>
          </Fact>
        </dl>
      </AdminSection>
    </div>
  );
}
