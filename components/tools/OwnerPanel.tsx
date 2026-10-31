"use client";

import { ArrowRightIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Availability } from "@/convex/lib/tools";
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
import { Button, ButtonLink } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { messageForError } from "@/lib/convexErrors";
import { formatDay } from "@/lib/format";

interface OwnerPanelProps {
  toolId: Id<"tools">;
  toolName: string;
  availability: Availability;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The owner's side of a tool: edit, remove, and the way to its requests. */
export function OwnerPanel({ toolId, toolName, availability }: OwnerPanelProps) {
  const router = useRouter();
  const remove = useMutation(api.tools.remove);
  const mine = useQuery(api.tools.mine);
  const pending = mine?.find((tool) => tool._id === toolId)?.pendingRequests ?? 0;
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const onLoan = availability.state === "on_loan";
  const blockedReason = onLoan ? `On loan until ${formatDay(availability.until)}` : null;

  async function confirmRemove() {
    setRemoving(true);
    try {
      const { cancelledLoans } = await remove({ toolId });
      setOpen(false);
      toast.success(`${toolName} was removed`, {
        description:
          cancelledLoans > 0
            ? `${plural(cancelledLoans, "open request")} ${cancelledLoans === 1 ? "was" : "were"} cancelled and the borrowers told.`
            : "It no longer appears in Browse.",
      });
      router.push("/tools");
    } catch (error) {
      toast.error("The listing wasn't removed", { description: messageForError(error) });
    } finally {
      setRemoving(false);
    }
  }

  const removeButton = (
    <Button
      variant="outline"
      className="w-full justify-start text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
      disabled={onLoan}
    >
      <TrashIcon aria-hidden="true" />
      Remove listing
    </Button>
  );

  return (
    <section aria-labelledby="owner-panel-title" className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="grid gap-1 border-b border-border px-5 py-4">
        <h2 id="owner-panel-title" className="text-base font-semibold tracking-title">
          Your listing
        </h2>
        <p className="text-sm text-muted-foreground">Neighbours can find it in Browse and request free days.</p>
      </header>

      <div className="grid gap-2 px-5 py-4">
        <ButtonLink variant="outline" className="w-full justify-start" href={`/tools/${toolId}/edit`}>
          <PencilSimpleIcon aria-hidden="true" />
          Edit listing
        </ButtonLink>

        {blockedReason ? (
          <div className="grid gap-1.5">
            <Tooltip>
              <TooltipTrigger render={<span className="block" />}>{removeButton}</TooltipTrigger>
              <TooltipContent>{blockedReason}</TooltipContent>
            </Tooltip>
            <p className="text-xs text-muted-foreground">
              {blockedReason}. You can remove it once it&apos;s back.
            </p>
          </div>
        ) : (
          <AlertDialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
            <AlertDialogTrigger render={removeButton} />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <TrashIcon aria-hidden="true" />
                </AlertDialogMedia>
                <AlertDialogTitle>Remove {toolName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It leaves Browse right away.{" "}
                  {pending > 0
                    ? `${plural(pending, "open request")} will be cancelled and the borrowers told by email.`
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
        )}
      </div>

      <div className="border-t border-border bg-muted px-5 py-3">
        <Link
          href="/me/incoming"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
        >
          {pending > 0 ? `See ${plural(pending, "request")} for this tool` : "See requests for this tool"}
          <ArrowRightIcon aria-hidden="true" weight="bold" className="size-3.5" />
        </Link>
      </div>
    </section>
  );
}
