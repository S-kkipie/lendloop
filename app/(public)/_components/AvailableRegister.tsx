"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import type { api } from "@/convex/_generated/api";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryLabel } from "@/lib/categories";

/** Rows shown on the landing page; the full list lives behind sign-in. */
const VISIBLE_ROWS = 10;

const COLUMNS = "grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,9rem)] sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,14rem)]";

function RegisterFrame({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-b-xl border border-t-0 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3.5">
        <h2 id="register-title" className="text-[0.8125rem] font-normal text-muted-foreground">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

function ColumnHeads() {
  return (
    <div role="row" className={`${COLUMNS} bg-muted font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-muted-foreground`}>
      <span role="columnheader" className="px-4 py-2.5">
        No.
      </span>
      <span role="columnheader" className="px-4 py-2.5">
        Tool
      </span>
      <span role="columnheader" className="px-4 py-2.5">
        Category
      </span>
    </div>
  );
}

/** Server fallback while the register streams in: the same frame, quiet rows. */
export function RegisterSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading the tools available right now
      </span>
      <div aria-hidden="true">
        <RegisterFrame title={<Skeleton className="h-3.5 w-52" />}>
          <ColumnHeads />
          {[64, 48, 72, 56, 40].map((width, row) => (
            <div key={row} className={`${COLUMNS} items-center border-t border-border py-3.5`}>
              <Skeleton className="mx-4 h-3 w-7" />
              <Skeleton className="mx-4 h-3.5" style={{ width: `${width}%` }} />
              <Skeleton className="mx-4 h-3.5 w-20" />
            </div>
          ))}
        </RegisterFrame>
      </div>
    </div>
  );
}

/** Shown if Convex can't be reached when the page renders. */
export function RegisterUnavailable() {
  return (
    <RegisterFrame title="The list of available tools is offline for a moment.">
      <p className="px-4 py-6 text-sm text-muted-foreground">Reload the page in a minute to see what you can borrow.</p>
    </RegisterFrame>
  );
}

function MoreRow({ hidden }: { hidden: number }) {
  const { isSignedIn } = useAuth();
  const label = `${hidden} more ${hidden === 1 ? "tool" : "tools"} in the register`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-4 py-3">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      {isSignedIn ? (
        <Button size="sm" variant="link" render={<Link href="/tools" />} nativeButton={false}>
          Browse all tools
          <ArrowRightIcon aria-hidden="true" weight="bold" />
        </Button>
      ) : (
        <SignInButton mode="modal" fallbackRedirectUrl="/tools">
          <Button size="sm" variant="link">
            Sign in to see them all
            <ArrowRightIcon aria-hidden="true" weight="bold" />
          </Button>
        </SignInButton>
      )}
    </div>
  );
}

/**
 * The public register: tools nobody has borrowed right now, name and category
 * only (tools.listPublic returns nothing else). Preloaded on the server, then
 * live: a tool that goes out on loan leaves the list without a reload.
 */
export function AvailableRegister({ preloaded }: { preloaded: Preloaded<typeof api.tools.listPublic> }) {
  const tools = usePreloadedQuery(preloaded);
  // Rows present at first paint fade in as a sequence; rows that arrive later
  // (live updates) fade in on their own, without waiting for a stagger slot.
  const [firstPaintIds] = useState(() => new Set(tools.map((tool) => tool._id)));

  const count = tools.length;
  const visible = tools.slice(0, VISIBLE_ROWS);

  const title = (
    <>
      <strong className="font-semibold text-foreground">
        <NumberTicker value={count} />
      </strong>{" "}
      {count === 1 ? "tool" : "tools"} available right now
    </>
  );

  if (count === 0) {
    return (
      <RegisterFrame title={title}>
        <p className="px-4 py-8 text-sm text-muted-foreground">Nothing is free to borrow right now. Check back soon.</p>
      </RegisterFrame>
    );
  }

  return (
    <RegisterFrame title={title} aside={<span className="font-mono text-xs text-muted-foreground">updated live</span>}>
      <div role="table" aria-labelledby="register-title" className="text-sm">
        <div role="rowgroup">
          <ColumnHeads />
        </div>
        <div role="rowgroup">
          {visible.map((tool, index) => (
            <BlurFade
              key={tool._id}
              role="row"
              index={firstPaintIds.has(tool._id) ? index : 0}
              className={`${COLUMNS} items-baseline border-t border-border transition-[background-color] duration-(--dur-row) hover:bg-muted`}
            >
              <span role="cell" className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(3, "0")}
              </span>
              <span role="cell" className="truncate px-4 py-3 text-foreground">
                {tool.name}
              </span>
              <span role="cell" className="truncate px-4 py-3 text-muted-foreground">
                {categoryLabel(tool.category)}
              </span>
            </BlurFade>
          ))}
        </div>
      </div>
      {count > VISIBLE_ROWS ? <MoreRow hidden={count - VISIBLE_ROWS} /> : null}
    </RegisterFrame>
  );
}
