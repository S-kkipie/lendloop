"use client";

import { ArrowRightIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Availability } from "@/convex/lib/tools";
import { Button, ButtonLink } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDay } from "@/lib/format";
import { RemoveListingDialog } from "./RemoveListingDialog";

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
  const mine = useQuery(api.tools.mine);
  const pending = mine?.find((tool) => tool._id === toolId)?.pendingRequests ?? 0;

  const onLoan = availability.state === "on_loan";
  const blockedReason = onLoan ? `On loan until ${formatDay(availability.until)}` : null;

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
          <RemoveListingDialog
            toolId={toolId}
            toolName={toolName}
            trigger={removeButton}
            onRemoved={() => router.push("/tools")}
          />
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
