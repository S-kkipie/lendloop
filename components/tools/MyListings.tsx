"use client";

import { ArrowRightIcon, PencilSimpleIcon, PlusIcon, TagIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { BoardHeader } from "@/components/loans/LoanBoard";
import { EmptyState } from "@/components/shell/EmptyState";
import { Kbd } from "@/components/shell/Kbd";
import { LedgerList, LedgerRow } from "@/components/shell/LedgerList";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { categoryLabel } from "@/lib/categories";
import { conditionLabel } from "@/lib/conditions";
import { formatDay } from "@/lib/format";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { CategoryIcon } from "./CategoryIcon";
import { RemoveListingDialog } from "./RemoveListingDialog";

type Listing = FunctionReturnType<typeof api.tools.mine>[number];

const TITLE = "My listings";
const DESCRIPTION = "The tools you lend. Neighbours see the name, category, condition and your first name.";
const COLUMNS = "xl:grid-cols-[minmax(0,1fr)_max-content_max-content_max-content_max-content]";
const HEADS = ["Tool", "Availability", "Requests", "Status", "Actions"];

function ListAToolButton({ label = "List a tool" }: { label?: string }) {
  return (
    <ButtonLink href="/tools/new">
      <PlusIcon aria-hidden="true" weight="bold" />
      {label}
      <Kbd className="pointer-coarse:hidden">N</Kbd>
    </ButtonLink>
  );
}

function RowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3.5 xl:col-span-full xl:grid-cols-subgrid xl:gap-x-6"
    >
      <div className="grid gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="col-start-2 row-start-1 h-6 w-20 rounded-md xl:col-start-2" />
      <Skeleton className="hidden h-3.5 w-16 xl:block" />
      <Skeleton className="hidden h-6 w-16 rounded-md xl:block" />
      <Skeleton className="hidden h-8 w-36 rounded-lg xl:block" />
    </div>
  );
}

export function MyListingsSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6" aria-busy="true">
      <BoardHeader title={TITLE} description={DESCRIPTION} action={<ListAToolButton />} />
      <span className="sr-only" role="status">
        Loading your listings
      </span>
      <div aria-hidden="true">
        <LedgerList label="Loading" heads={HEADS} columns={COLUMNS}>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </LedgerList>
      </div>
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ListingRow({ tool }: { tool: Listing }) {
  const nameId = useId();
  // The Remove button leaves with the listing; focus lands on its name instead.
  const nameRef = useRef<HTMLAnchorElement>(null);
  const removed = tool.status === "removed";
  const blockedReason =
    !removed && !tool.canDelete && tool.availability.state === "on_loan"
      ? `On loan until ${formatDay(tool.availability.until)}`
      : null;

  const removeButton = (
    <Button
      data-row-action=""
      size="sm"
      variant="outline"
      className="flex-1 text-danger-ink hover:bg-danger-soft hover:text-danger-ink sm:flex-none"
      disabled={Boolean(blockedReason)}
      focusableWhenDisabled={Boolean(blockedReason)}
    >
      <TrashIcon aria-hidden="true" />
      Remove
    </Button>
  );

  return (
    <LedgerRow aria-labelledby={nameId}>
      <div className="col-start-1 row-start-1 grid min-w-0 content-start">
        <Link
          id={nameId}
          ref={nameRef}
          href={`/tools/${tool._id}`}
          className="w-fit max-w-full rounded-sm text-[0.9375rem] leading-6 font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline"
        >
          {tool.name}
        </Link>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-5 text-muted-foreground">
          <CategoryIcon category={tool.category} aria-hidden="true" className="size-3.5 shrink-0" />
          {categoryLabel(tool.category)}
          <span aria-hidden="true">·</span>
          {conditionLabel(tool.condition)}
        </p>
      </div>

      {/* Availability: top right when stacked, its own column from xl. */}
      <div className="col-start-2 row-start-1 flex justify-self-end xl:col-start-2 xl:justify-self-start">
        {removed ? (
          <span className="text-[0.8125rem] leading-6 text-muted-foreground">Not in Browse</span>
        ) : (
          <AvailabilityBadge availability={tool.availability} />
        )}
      </div>

      <div className="col-span-2 row-start-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 xl:contents">
        <p className="text-[0.8125rem] leading-6 xl:col-start-3 xl:row-start-1">
          {tool.pendingRequests > 0 ? (
            <Link
              href="/me/incoming"
              className="inline-flex items-center gap-1 rounded-sm font-medium text-primary-ink underline-offset-4 hover:underline"
            >
              <span className="font-mono">{tool.pendingRequests}</span>
              {tool.pendingRequests === 1 ? " request" : " requests"}
              <span className="sr-only"> waiting for {tool.name}</span>
              <ArrowRightIcon aria-hidden="true" weight="bold" className="size-3" />
            </Link>
          ) : (
            <span className="text-muted-foreground">No requests</span>
          )}
        </p>
        <div className="flex xl:col-start-4 xl:row-start-1">
          {removed ? <Badge variant="outline">Removed</Badge> : <Badge variant="neutral">Listed</Badge>}
        </div>
      </div>

      {removed && tool.removalReason ? (
        <p className="col-span-2 row-start-3 mt-1.5 text-[0.8125rem] leading-5 text-muted-foreground xl:col-span-4 xl:col-start-1 xl:row-start-2">
          Removed by a moderator: “{tool.removalReason}”
        </p>
      ) : null}

      {removed ? null : (
        <div className="col-span-2 row-start-4 mt-3 flex flex-wrap items-center gap-2 xl:col-span-1 xl:col-start-5 xl:row-start-1 xl:-my-1 xl:justify-self-end">
          <ButtonLink
            data-row-action=""
            href={`/tools/${tool._id}/edit`}
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
          >
            <PencilSimpleIcon aria-hidden="true" />
            Edit<span className="sr-only"> {tool.name}</span>
          </ButtonLink>
          {blockedReason ? (
            <Tooltip>
              <TooltipTrigger render={removeButton} />
              <TooltipContent>{blockedReason}. You can remove it once it&apos;s back.</TooltipContent>
            </Tooltip>
          ) : (
            <RemoveListingDialog
              toolId={tool._id}
              toolName={tool.name}
              trigger={removeButton}
              focusAfterRemove={nameRef}
            />
          )}
        </div>
      )}
    </LedgerRow>
  );
}

/** My listings: every tool the viewer lends (removed ones last), with requests waiting and quick edits. */
export function MyListings() {
  const tools = useQuery(api.tools.mine);
  if (tools === undefined) return <MyListingsSkeleton />;

  const listed = tools.filter((t) => t.status === "listed");
  const removed = tools.filter((t) => t.status === "removed");
  const waiting = listed.reduce((sum, t) => sum + t.pendingRequests, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description={DESCRIPTION} action={tools.length > 0 ? <ListAToolButton /> : null} />

      {tools.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="You haven't listed anything yet"
          body="Lend the drill that sits in a drawer most of the year. Neighbours can request it for the days they need."
          action={<ListAToolButton label="List your first tool" />}
        />
      ) : (
        <section aria-label="Listings" className="grid gap-3">
          <p role="status" className="font-mono text-xs text-muted-foreground">
            {plural(listed.length, "tool")} listed
            {waiting > 0 ? `, ${plural(waiting, "request")} waiting` : ""}
            {removed.length > 0 ? `, ${removed.length} removed` : ""}
          </p>
          <LedgerList label="Your tools" heads={HEADS} columns={COLUMNS}>
            {[...listed, ...removed].map((tool) => (
              <ListingRow key={tool._id} tool={tool} />
            ))}
          </LedgerList>
        </section>
      )}
    </div>
  );
}
