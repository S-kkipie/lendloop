"use client";

import { ArrowRightIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/validators";
import { DateRangePicker, type DaySelection } from "@/components/loans/DateRangePicker";
import { Label } from "@/components/ui/label";
import { StatefulButton, type ActionState } from "@/components/ui/stateful-button";
import { Textarea } from "@/components/ui/textarea";
import { earliestStartDay, type DayRange } from "@/lib/calendarDays";
import { messageForError } from "@/lib/convexErrors";
import { dayCount, formatRange } from "@/lib/format";

/** Pause on "Requested" long enough to read it before moving on. */
const SUCCESS_HOLD_MS = 700;

interface BookingPanelProps {
  toolId: Id<"tools">;
  toolName: string;
  ownerName: string;
  booked: readonly DayRange[];
}

function PanelFrame({
  titleId,
  title = "When do you need it?",
  description = `Pick the first and last day. Up to ${LIMITS.maxLoanDays} days.`,
  children,
}: {
  titleId: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="grid gap-1 border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold tracking-title">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * The borrower's side of a tool: pick free days, add a note, request. If a
 * request for this tool is already waiting, the panel says so instead (the
 * server allows one pending request per tool and borrower).
 */
export function BookingPanel({ toolId, toolName, ownerName, booked }: BookingPanelProps) {
  const router = useRouter();
  const request = useMutation(api.loans.request);
  const myRequests = useQuery(api.loans.myRequests);
  const titleId = useId();
  const messageId = useId();
  const counterId = useId();
  const errorId = useId();
  const calendarRef = useRef<HTMLDivElement>(null);

  // The calendar reads "today", so it renders only in the browser.
  const [firstDay] = useState(() => earliestStartDay());
  const [dates, setDates] = useState<DaySelection | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  const waiting = myRequests?.find((loan) => loan.tool._id === toolId && loan.status === "pending");
  const ownerFirstName = ownerName.split(" ")[0] || ownerName;

  // Right after a successful request the live query already shows it as
  // waiting; keep the form (and its "Requested" button) until we navigate.
  if (waiting && state === "idle") {
    return (
      <PanelFrame titleId={titleId} title="Request sent" description="One request per tool at a time.">
        <div className="grid gap-3 px-5 py-5">
          <p className="flex items-start gap-2 text-sm">
            <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              You asked for <span className="font-mono">{formatRange(waiting.startDate, waiting.endDate)}</span>.{" "}
              {ownerFirstName} hasn&apos;t answered yet. You&apos;ll get an email when they do.
            </span>
          </p>
          <Link
            href="/me/requests"
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
          >
            See my requests
            <ArrowRightIcon aria-hidden="true" weight="bold" className="size-3.5" />
          </Link>
        </div>
      </PanelFrame>
    );
  }

  const end = dates ? (dates.end ?? dates.start) : null;
  const summary = dates && end ? `${formatRange(dates.start, end)} · ${dayCount(dates.start, end)}` : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "idle") return;
    if (!dates || !end) {
      setError("Pick your dates on the calendar first.");
      calendarRef.current?.querySelector<HTMLButtonElement>('button[data-day][tabindex="0"]')?.focus();
      return;
    }
    setError(null);
    setState("loading");
    try {
      await request({
        toolId,
        startDate: dates.start,
        endDate: end,
        message: message.trim() || undefined,
      });
      setState("success");
      toast.success(`Request sent to ${ownerName}`, {
        description: `${toolName}, ${formatRange(dates.start, end)}. You'll get an email when they answer.`,
      });
      leaveTimer.current = setTimeout(() => router.push("/me/requests"), SUCCESS_HOLD_MS);
    } catch (caught) {
      setState("idle");
      setError(messageForError(caught));
    }
  }

  return (
    <PanelFrame titleId={titleId}>
      <div ref={calendarRef} className="px-3 pt-4 sm:px-5">
        <DateRangePicker
          value={dates}
          onChange={(next) => {
            setDates(next);
            setError(null);
          }}
          booked={booked}
          firstDay={firstDay}
          maxDays={LIMITS.maxLoanDays}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      <form onSubmit={submit} noValidate className="grid gap-4 border-t border-border px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Your dates</span>
          <span className={summary ? "font-mono text-foreground" : "text-muted-foreground"}>
            {summary ?? "None picked yet"}
          </span>
        </div>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={messageId}>
              Note for {ownerFirstName} <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <span id={counterId} className="font-mono text-xs text-muted-foreground" aria-live="off">
              {message.length}/{LIMITS.messageMax}
            </span>
          </div>
          <Textarea
            id={messageId}
            value={message}
            maxLength={LIMITS.messageMax}
            rows={3}
            placeholder="What it's for, or when you could pick it up"
            aria-describedby={counterId}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-20 resize-none"
          />
        </div>

        {error ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger-ink">
            <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-2">
          <StatefulButton
            type="submit"
            size="lg"
            className="w-full"
            state={state}
            labels={{ idle: "Request dates", loading: "Sending…", success: "Requested" }}
          />
          <p className="text-xs text-muted-foreground">
            {ownerFirstName} gets an email and answers here. Nothing is booked until they approve.
          </p>
        </div>
      </form>
    </PanelFrame>
  );
}
