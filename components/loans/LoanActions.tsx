"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  ArrowUUpLeftIcon,
  CheckIcon,
  HandshakeIcon,
  ProhibitIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { useMutation } from "convex/react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { serverToday } from "@/lib/calendarDays";
import { messageForError } from "@/lib/convexErrors";
import { firstName, formatDay, formatRange, inSentence } from "@/lib/format";
import { nextActionsFor, type LoanAction, type LoanStatus } from "@/lib/loanStatus";

/** The fields of a loan summary (loans.incoming / myRequests / timeline) the actions need. */
export interface ActionableLoan {
  _id: Id<"loans">;
  status: LoanStatus;
  startDate: string;
  endDate: string;
  tool: { name: string };
  owner: { displayName: string };
  borrower: { displayName: string };
  /** Overlapping open requests (loans.incoming, pending rows only). */
  conflicts?: number;
}

/** What else is booked around a pending request, from the owner's own list. */
export interface OverlapFacts {
  /** Other pending requests that approving this one would decline. */
  pending: number;
  /** An approved or active loan already holds some of these days. */
  booked: boolean;
}

interface LoanActionsProps {
  loan: ActionableLoan;
  viewer: "owner" | "borrower";
  overlap?: OverlapFacts;
  /** Shown after the actions, in the same row (e.g. a "View" link). */
  trailing?: ReactNode;
  className?: string;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * After an action the row usually leaves its list (approved requests move to
 * Upcoming). Keep keyboard users in place: focus the next row's first action,
 * else the previous row's, else the list's panel.
 */
export function keepFocusNear(origin: HTMLElement | null) {
  const row = origin?.closest<HTMLElement>("[data-loan-row]");
  if (!row) return;
  const candidates = [row.nextElementSibling, row.previousElementSibling].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const panel = row.closest<HTMLElement>("[data-loan-list]");
  const restore = () => {
    if (row.isConnected) return; // the row stayed (e.g. the timeline header)
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    for (const candidate of candidates) {
      if (!candidate.isConnected) continue;
      const target =
        candidate.querySelector<HTMLElement>("[data-row-action]:not([disabled])") ??
        candidate.querySelector<HTMLElement>("a[href]");
      if (target) return target.focus();
    }
    panel?.focus();
  };
  requestAnimationFrame(restore);
  // A confirmation dialog hands focus back to its (now gone) trigger after
  // its exit transition; check again once it has finished.
  setTimeout(restore, 260);
}

/** Appears only if an action takes longer than 150 ms, so fast ones don't flash. */
function DelayedSpinner() {
  return (
    <span className="inline-flex [animation:fade-in_120ms_var(--ease-out)_150ms_both]">
      <SpinnerGapIcon aria-hidden="true" className="animate-spin" />
    </span>
  );
}

/** A row action button: secondary actions are outline, the next step is cobalt. */
function ActionButton({
  icon: IconComponent,
  label,
  subject,
  primary,
  busy,
  disabledReason,
  onClick,
}: {
  icon: Icon;
  label: ReactNode;
  /** Which loan, for screen readers: rows repeat the same buttons ("Approve"). */
  subject: string;
  primary?: boolean;
  busy: boolean;
  disabledReason?: string | null;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const button = (
    <Button
      data-row-action=""
      size="sm"
      variant={primary ? "default" : "outline"}
      className="flex-1 sm:flex-none"
      disabled={Boolean(disabledReason)}
      focusableWhenDisabled={Boolean(disabledReason)}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? (
        <DelayedSpinner />
      ) : (
        <IconComponent aria-hidden="true" weight={primary ? "bold" : "regular"} />
      )}
      {/* One flex item, so the button's gap never splits "Hand over · starts Nov 18". */}
      <span>{label}</span>
      <span className="sr-only">: {subject}</span>
    </Button>
  );
  if (!disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

const ORDER: Record<LoanAction, number> = { decline: 0, cancel: 1, approve: 2, handOver: 3, markReturned: 4 };

interface Confirmation {
  action: LoanAction;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  icon: Icon;
  tone: "primary" | "danger";
}

/**
 * The buttons a party sees for a loan, mirroring the server's state machine
 * (nextActionsFor). Confirmations only guard side effects: approving a request
 * that declines overlapping ones, cancelling an approved booking, and marking
 * a loan returned. Everything else acts at once with a quiet toast.
 */
export function LoanActions({ loan, viewer, overlap, trailing, className }: LoanActionsProps) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const handOver = useMutation(api.loans.handOver);
  const markReturned = useMutation(api.loans.markReturned);

  const groupRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<LoanAction | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Secondary actions first, the next step last (rightmost, cobalt).
  const actions = nextActionsFor(viewer, loan.status).sort((a, b) => ORDER[a] - ORDER[b]);
  if (actions.length === 0) {
    return trailing ? <div className={cn("flex flex-wrap items-center gap-2", className)}>{trailing}</div> : null;
  }

  const borrower = firstName(loan.borrower.displayName);
  const owner = firstName(loan.owner.displayName);
  const counterpart = viewer === "owner" ? borrower : owner;
  const tool = inSentence(loan.tool.name);
  const subject = `${loan.tool.name}, ${viewer === "owner" ? loan.borrower.displayName : loan.owner.displayName}`;
  const dates = formatRange(loan.startDate, loan.endDate);
  const today = serverToday();
  const ended = today > loan.endDate;
  const conflicts = loan.conflicts ?? 0;
  const declines = overlap?.pending ?? conflicts;

  async function run(action: LoanAction) {
    if (busy) return;
    setBusy(action);
    const origin = groupRef.current;
    const loanId = loan._id;
    try {
      switch (action) {
        case "approve": {
          const { autoDeclined } = await approve({ loanId });
          toast.success(`Approved ${borrower}'s request`, {
            description:
              autoDeclined > 0
                ? `${plural(autoDeclined, "overlapping request")} ${autoDeclined === 1 ? "was" : "were"} declined. We'll email ${borrower} and ${autoDeclined === 1 ? "the other borrower" : "the other borrowers"}.`
                : `${dates}. We'll email ${borrower}.`,
          });
          break;
        }
        case "decline":
          await decline({ loanId });
          toast(`Declined ${borrower}'s request`, { description: `We'll email ${borrower}.` });
          break;
        case "cancel":
          await cancel({ loanId });
          toast(loan.status === "approved" ? "Booking cancelled" : "Request cancelled", {
            description: `We'll email ${counterpart}.`,
          });
          break;
        case "handOver":
          await handOver({ loanId });
          toast.success(`Handed over to ${borrower}`, { description: `Due back ${formatDay(loan.endDate)}.` });
          break;
        case "markReturned":
          await markReturned({ loanId });
          toast.success(`${loan.tool.name} is back`, { description: "The loan is closed." });
          break;
      }
      setDialogOpen(false);
      keepFocusNear(origin);
    } catch (error) {
      toast.error("That didn't go through", { description: messageForError(error) });
    } finally {
      setBusy(null);
    }
  }

  function ask(confirmation: Confirmation) {
    setConfirming(confirmation);
    setDialogOpen(true);
  }

  const buttons: ReactNode[] = [];
  for (const action of actions) {
    const isBusy = busy === action;
    switch (action) {
      case "decline":
        buttons.push(
          <ActionButton subject={subject} key={action} icon={XIcon} label="Decline" busy={isBusy} onClick={() => run("decline")} />,
        );
        break;
      case "approve":
        buttons.push(
          <ActionButton subject={subject}
            key={action}
            icon={CheckIcon}
            label="Approve"
            primary
            busy={isBusy}
            disabledReason={overlap?.booked ? "These dates are already booked" : null}
            onClick={() =>
              conflicts > 0
                ? ask({
                    action,
                    title: `Approve ${borrower}'s request?`,
                    description: `${borrower} gets the ${tool} for ${dates}. This declines ${plural(declines, "overlapping request")}, and we'll email ${declines === 1 ? "its borrower" : "their borrowers"}.`,
                    confirmLabel: `Approve and decline ${declines}`,
                    cancelLabel: "Not yet",
                    icon: CheckIcon,
                    tone: "primary",
                  })
                : run("approve")
            }
          />,
        );
        break;
      case "cancel": {
        const booked = loan.status === "approved";
        buttons.push(
          <ActionButton subject={subject}
            key={action}
            icon={ProhibitIcon}
            label={booked ? "Cancel booking" : "Cancel request"}
            busy={isBusy}
            onClick={() =>
              booked
                ? ask({
                    action,
                    title: "Cancel this booking?",
                    description: `${counterpart} will be told by email, and ${dates} frees up for others.`,
                    confirmLabel: "Cancel booking",
                    cancelLabel: "Keep booking",
                    icon: ProhibitIcon,
                    tone: "danger",
                  })
                : run("cancel")
            }
          />,
        );
        break;
      }
      case "handOver": {
        const upcoming = loan.startDate > today;
        buttons.push(
          <ActionButton subject={subject}
            key={action}
            icon={HandshakeIcon}
            label={
              upcoming ? (
                <>
                  Hand over<span aria-hidden="true"> ·</span>
                  <span className="sr-only">,</span> starts {formatDay(loan.startDate)}
                </>
              ) : (
                "Hand over"
              )
            }
            primary
            busy={isBusy}
            disabledReason={ended ? `The booking ended ${formatDay(loan.endDate)}` : null}
            onClick={() => run("handOver")}
          />,
        );
        break;
      }
      case "markReturned":
        buttons.push(
          <ActionButton subject={subject}
            key={action}
            icon={ArrowUUpLeftIcon}
            label="Mark returned"
            primary
            busy={isBusy}
            onClick={() =>
              ask({
                action,
                title: `Confirm you have the ${tool} back?`,
                description: `This closes the loan and lets ${borrower} know it's done.`,
                confirmLabel: "Mark returned",
                cancelLabel: "Not yet",
                icon: ArrowUUpLeftIcon,
                tone: "primary",
              })
            }
          />,
        );
        break;
    }
  }

  const MediaIcon = confirming?.icon;

  return (
    <div ref={groupRef} className={cn("flex flex-wrap items-center gap-2", className)}>
      {buttons}
      {trailing}
      <AlertDialog open={dialogOpen} onOpenChange={(next) => !busy && setDialogOpen(next)}>
        <AlertDialogContent>
          {confirming && MediaIcon ? (
            <>
              <AlertDialogHeader>
                <AlertDialogMedia
                  className={confirming.tone === "primary" ? "bg-primary-soft text-primary-ink" : undefined}
                >
                  <MediaIcon aria-hidden="true" />
                </AlertDialogMedia>
                <AlertDialogTitle>{confirming.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirming.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={Boolean(busy)}>{confirming.cancelLabel}</AlertDialogCancel>
                <Button
                  variant={confirming.tone === "danger" ? "destructive" : "default"}
                  aria-busy={busy ? true : undefined}
                  onClick={() => run(confirming.action)}
                >
                  {busy ? <DelayedSpinner /> : null}
                  {confirming.confirmLabel}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
