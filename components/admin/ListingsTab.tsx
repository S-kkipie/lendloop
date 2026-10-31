"use client";

import { TagIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerCell, LedgerList } from "@/components/shell/LedgerList";
import { CategoryIcon } from "@/components/tools/CategoryIcon";
import { RemoveListingDialog } from "@/components/tools/RemoveListingDialog";
import { TrustedBadge } from "@/components/tools/TrustedBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/categories";
import { cn } from "cn";
import { AdminRow, plural, STRETCHED_LINK, TableSkeleton, ToggleChips, Toolbar } from "./shared";

type Listing = FunctionReturnType<typeof api.admin.listTools>[number];
type Filter = "all" | "listed" | "removed";

// Account deletion removes the listings with this code as the reason (convex/users.ts).
const ACCOUNT_DELETED = "account_deleted";

const HEADS = ["Tool", "Category", "Owner", "Status", "Actions"] as const;
const COLUMNS = "xl:grid-cols-[minmax(0,1fr)_max-content_max-content_max-content_max-content]";

function ListingAdminRow({ tool }: { tool: Listing }) {
  const nameId = useId();
  const nameRef = useRef<HTMLAnchorElement>(null);
  const removed = tool.status === "removed";

  return (
    <AdminRow aria-labelledby={nameId}>
      <LedgerCell className="col-start-1 row-start-1 grid content-start">
        <Link
          id={nameId}
          ref={nameRef}
          href={`/tools/${tool._id}`}
          className={cn(STRETCHED_LINK, "w-fit text-sm leading-6", removed && "text-muted-foreground")}
        >
          {tool.name}
        </Link>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-5 text-muted-foreground xl:hidden">
          <CategoryIcon category={tool.category} aria-hidden="true" className="size-3.5 shrink-0" />
          {categoryLabel(tool.category)}
          <span aria-hidden="true">·</span>
          {tool.owner.displayName}
          {tool.owner.isTrustedLender ? <TrustedBadge compact /> : null}
        </p>
        {removed ? (
          <p className="mt-0.5 max-w-[60ch] text-[0.8125rem] leading-5 text-muted-foreground">
            {tool.removalReason === ACCOUNT_DELETED ? (
              "Removed with the owner's account."
            ) : tool.removalReason ? (
              <>
                <span className="font-medium text-foreground">Moderator&apos;s reason:</span> “{tool.removalReason}”
              </>
            ) : (
              "Removed by its owner."
            )}
          </p>
        ) : null}
      </LedgerCell>
      <LedgerCell className="hidden items-center gap-1.5 text-[0.8125rem] text-muted-foreground xl:flex">
        <CategoryIcon category={tool.category} aria-hidden="true" className="size-3.5 shrink-0" />
        {categoryLabel(tool.category)}
      </LedgerCell>
      <LedgerCell className="hidden items-center gap-2 text-[0.8125rem] xl:flex">
        <span className="truncate">{tool.owner.displayName}</span>
        {tool.owner.isTrustedLender ? <TrustedBadge compact /> : null}
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 flex self-start justify-self-end xl:col-start-auto xl:row-start-auto xl:self-center xl:justify-self-start">
        {removed ? <Badge variant="outline">Removed</Badge> : <Badge variant="neutral">Listed</Badge>}
      </LedgerCell>
      <LedgerCell className="col-span-2 row-start-2 flex justify-end empty:hidden xl:col-span-1 xl:row-start-auto max-xl:mt-2.5">
        {removed ? null : (
          <RemoveListingDialog
            toolId={tool._id}
            toolName={tool.name}
            moderation={{ ownerName: tool.owner.displayName }}
            focusAfterRemove={nameRef}
            trigger={
              <Button
                data-row-action=""
                size="sm"
                variant="ghost"
                className="relative z-10 text-muted-foreground hover:bg-danger-soft hover:text-danger-ink aria-expanded:bg-danger-soft aria-expanded:text-danger-ink"
              >
                <TrashIcon aria-hidden="true" />
                Remove<span className="sr-only"> {tool.name}</span>
              </Button>
            }
          />
        )}
      </LedgerCell>
    </AdminRow>
  );
}

/**
 * Every listing, removed ones included with the moderator's reason. Removing
 * one asks for a reason the owner will see; open requests are cancelled.
 */
export function ListingsTab() {
  const tools = useQuery(api.admin.listTools);
  const [filter, setFilter] = useState<Filter>("all");

  if (tools === undefined) {
    return (
      <div className="grid gap-4">
        <Toolbar summary="Loading listings" />
        <TableSkeleton heads={HEADS} columns={COLUMNS} />
      </div>
    );
  }

  const listed = tools.filter((t) => t.status === "listed");
  const removed = tools.filter((t) => t.status === "removed");
  const shown = filter === "listed" ? listed : filter === "removed" ? removed : tools;

  return (
    <div className="grid gap-4">
      <Toolbar summary={`${plural(shown.length, "listing")}, newest first`}>
        <ToggleChips<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: tools.length },
            { value: "listed", label: "Listed", count: listed.length },
            { value: "removed", label: "Removed", count: removed.length },
          ]}
        />
      </Toolbar>
      {shown.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title={filter === "removed" ? "Nothing has been removed" : "No listings yet"}
          body={
            filter === "removed"
              ? "Listings taken down by their owners or by a moderator show up here with the reason."
              : "Tools appear here as soon as a neighbour lists one."
          }
          action={
            filter === "all" ? undefined : (
              <Button variant="outline" onClick={() => setFilter("all")}>
                Show all listings
              </Button>
            )
          }
        />
      ) : (
        <LedgerList label="Listings" heads={HEADS} columns={COLUMNS} semantics="table">
          {shown.map((tool) => (
            <ListingAdminRow key={tool._id} tool={tool} />
          ))}
        </LedgerList>
      )}
    </div>
  );
}
