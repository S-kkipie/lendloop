"use client";

import { TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import { useState, type ReactElement } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { messageForError } from "@/lib/convexErrors";

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

interface RemoveListingDialogProps {
  toolId: Id<"tools">;
  toolName: string;
  /** The button that opens the confirmation. */
  trigger: ReactElement;
  onRemoved?: () => void;
}

/** Confirms removing a listing (it cancels open requests and notifies their borrowers). */
export function RemoveListingDialog({ toolId, toolName, trigger, onRemoved }: RemoveListingDialogProps) {
  const remove = useMutation(api.tools.remove);
  // Removing a listing cancels its pending requests and approved bookings.
  const loans = useQuery(api.loans.incoming);
  const forTool = loans?.filter((loan) => loan.tool._id === toolId) ?? [];
  const affected = openLoansText(
    forTool.filter((loan) => loan.status === "pending").length,
    forTool.filter((loan) => loan.status === "approved").length,
  );
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function confirmRemove() {
    if (removing) return;
    setRemoving(true);
    try {
      const { cancelledLoans } = await remove({ toolId });
      setOpen(false);
      toast.success(`${toolName} was removed`, {
        description:
          cancelledLoans > 0
            ? `${plural(cancelledLoans, "request")} ${cancelledLoans === 1 ? "was" : "were"} cancelled and the borrowers told.`
            : "It no longer appears in Browse.",
      });
      onRemoved?.();
    } catch (error) {
      toast.error("The listing wasn't removed", { description: messageForError(error) });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove {toolName}?</AlertDialogTitle>
          <AlertDialogDescription>
            It leaves Browse right away.{" "}
            {affected
              ? `${affected} will be cancelled, and the borrowers told by email.`
              : "Nobody has asked for it right now."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Keep listing</AlertDialogCancel>
          <Button variant="destructive" onClick={confirmRemove} aria-busy={removing || undefined}>
            {removing ? "Removing…" : "Remove listing"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
