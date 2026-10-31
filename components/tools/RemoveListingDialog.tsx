"use client";

import { TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import { useId, useRef, useState, type FormEvent, type ReactElement, type RefObject } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/validators";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { messageForError } from "@/lib/convexErrors";
import { formatDay } from "@/lib/format";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "2 open requests and 1 approved booking", or null when there are none. */
function openLoansText(requests: number, bookings: number): string | null {
  const parts = [
    requests > 0 ? plural(requests, "open request") : null,
    bookings > 0 ? plural(bookings, "approved booking") : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : null;
}

function reasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return "Tell the owner why it's being removed.";
  if (length < LIMITS.removalReasonMin) return `Use at least ${LIMITS.removalReasonMin} characters.`;
  if (length > LIMITS.removalReasonMax) return `Keep it to ${LIMITS.removalReasonMax} characters.`;
  return null;
}

interface RemoveListingDialogProps {
  toolId: Id<"tools">;
  toolName: string;
  /** The button that opens the confirmation. */
  trigger: ReactElement;
  onRemoved?: () => void;
  /**
   * An admin removing someone else's listing: the dialog asks for a reason
   * (3 to 200 characters), which the owner sees on the listing.
   */
  moderation?: { ownerName: string };
  /** Where focus lands after a removal (the trigger usually disappears with it). */
  focusAfterRemove?: RefObject<HTMLElement | null>;
}

/**
 * Confirms removing a listing (it cancels open requests and notifies their
 * borrowers). Owners confirm; moderators also give the owner a reason.
 */
export function RemoveListingDialog({
  toolId,
  toolName,
  trigger,
  onRemoved,
  moderation,
  focusAfterRemove,
}: RemoveListingDialogProps) {
  const [open, setOpen] = useState(false);
  const removedRef = useRef(false);
  const removeOwn = useMutation(api.tools.remove);
  const removeAsAdmin = useMutation(api.admin.removeTool);

  // Removing a listing cancels its pending requests and approved bookings.
  const incoming = useQuery(api.loans.incoming, moderation ? "skip" : {});
  const pendingAll = useQuery(api.admin.listLoans, moderation && open ? { status: "pending" } : "skip");
  const approvedAll = useQuery(api.admin.listLoans, moderation && open ? { status: "approved" } : "skip");
  const activeAll = useQuery(api.admin.listLoans, moderation && open ? { status: "active" } : "skip");
  const forTool = (moderation ? [...(pendingAll ?? []), ...(approvedAll ?? [])] : (incoming ?? [])).filter(
    (loan) => loan.tool._id === toolId,
  );
  const affected = openLoansText(
    forTool.filter((loan) => loan.status === "pending").length,
    forTool.filter((loan) => loan.status === "approved").length,
  );
  const onLoan = activeAll?.find((loan) => loan.tool._id === toolId);

  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const ids = { reason: useId(), help: useId(), count: useId() };
  const error = moderation && submitted ? reasonError(reason) : null;

  async function confirmRemove(event?: FormEvent) {
    event?.preventDefault();
    if (removing) return;
    if (moderation) {
      setSubmitted(true);
      if (reasonError(reason)) {
        reasonRef.current?.focus();
        return;
      }
    }
    setRemoving(true);
    try {
      const { cancelledLoans } = moderation
        ? await removeAsAdmin({ toolId, reason: reason.trim() })
        : await removeOwn({ toolId });
      removedRef.current = true;
      setOpen(false);
      const cancelled =
        cancelledLoans > 0
          ? `${plural(cancelledLoans, "request")} ${cancelledLoans === 1 ? "was" : "were"} cancelled and the borrowers told.`
          : null;
      toast.success(`${toolName} was removed`, {
        description: moderation
          ? [`${moderation.ownerName} was told by email.`, cancelled].filter(Boolean).join(" ")
          : (cancelled ?? "It no longer appears in Browse."),
      });
      onRemoved?.();
    } catch (caught) {
      toast.error("The listing wasn't removed", { description: messageForError(caught) });
    } finally {
      setRemoving(false);
    }
  }

  const description = moderation ? (
    <>
      It leaves Browse right away. {moderation.ownerName} is told by email and sees your reason on the listing.{" "}
      {affected ? `${affected} will be cancelled, and the borrowers told.` : "Nobody has asked for it right now."}
      {onLoan
        ? ` ${onLoan.borrower.displayName} has it now (due back ${formatDay(onLoan.endDate)}); that loan carries on until it's returned.`
        : null}
    </>
  ) : (
    <>
      It leaves Browse right away.{" "}
      {affected ? `${affected} will be cancelled, and the borrowers told by email.` : "Nobody has asked for it right now."}
    </>
  );

  const footer = (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={removing}>Keep listing</AlertDialogCancel>
      <Button
        type={moderation ? "submit" : "button"}
        variant="destructive"
        onClick={moderation ? undefined : () => confirmRemove()}
        aria-busy={removing || undefined}
      >
        {removing ? "Removing…" : "Remove listing"}
      </Button>
    </AlertDialogFooter>
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (removing) return;
        setOpen(next);
        if (next) {
          removedRef.current = false;
          setReason("");
          setSubmitted(false);
        }
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent
        initialFocus={moderation ? reasonRef : undefined}
        finalFocus={() => (removedRef.current && focusAfterRemove?.current) || true}
      >
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove {toolName}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {moderation ? (
          <form onSubmit={confirmRemove} noValidate className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={ids.reason}>Reason for {moderation.ownerName}</Label>
                <span id={ids.count} className="font-mono text-xs text-muted-foreground tabular-nums">
                  {reason.trim().length}/{LIMITS.removalReasonMax}
                </span>
              </div>
              <Textarea
                id={ids.reason}
                ref={reasonRef}
                value={reason}
                maxLength={LIMITS.removalReasonMax}
                rows={3}
                placeholder="Listed twice; the other listing stays up."
                aria-invalid={error ? true : undefined}
                aria-describedby={`${ids.help} ${ids.count}`}
                onChange={(event) => setReason(event.target.value)}
              />
              {error ? (
                <p id={ids.help} className="flex items-start gap-1.5 text-xs text-danger-ink">
                  <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-px size-3.5 shrink-0" />
                  {error}
                </p>
              ) : (
                <p id={ids.help} className="text-xs text-muted-foreground">
                  {LIMITS.removalReasonMin} to {LIMITS.removalReasonMax} characters. It&apos;s kept in the audit log.
                </p>
              )}
            </div>
            {footer}
          </form>
        ) : (
          footer
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
