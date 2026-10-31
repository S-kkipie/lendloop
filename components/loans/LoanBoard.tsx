"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { LedgerList } from "@/components/shell/LedgerList";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsCount } from "@/components/ui/tabs";
import { cn } from "cn";
import { LOAN_COLUMNS, LoanRowSkeleton } from "./LoanRow";

/**
 * The selected tab lives in ?tab= so reloads, links and Back keep it. The
 * default tab keeps the URL clean.
 */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const current = tabs.includes(raw as T) ? (raw as T) : fallback;
  const select = (next: T) => {
    const query = new URLSearchParams(params.toString());
    if (next === fallback) query.delete("tab");
    else query.set("tab", next);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  return [current, select];
}

/** Tab label with its mono count; the count is cobalt only where action is waiting. */
export function TabLabel({ label, count, loud = false }: { label: string; count: number; loud?: boolean }) {
  return (
    <>
      {label}
      <TabsCount className={cn(!(loud && count > 0) && "bg-neutral-soft text-neutral-ink")}>
        {count}
        <span className="sr-only"> {count === 1 ? "item" : "items"}</span>
      </TabsCount>
    </>
  );
}

export function BoardHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-title">{title}</h1>
        <p className="max-w-[60ch] text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

/** Page-shaped placeholder: header, tab strip and a framed list. */
export function BoardSkeleton({ title, description, tabs }: { title: string; description: string; tabs: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6" aria-busy="true">
      <BoardHeader title={title} description={description} />
      <span className="sr-only" role="status">
        Loading
      </span>
      <div aria-hidden="true" className="grid gap-4">
        <div className="flex h-10 items-center gap-6 border-b border-border">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} className="h-3.5 w-24" />
          ))}
        </div>
        <LedgerList label="Loading" heads={["Tool", "Dates", "Status", "Actions"]} columns={LOAN_COLUMNS}>
          <LoanRowSkeleton />
          <LoanRowSkeleton />
          <LoanRowSkeleton />
        </LedgerList>
      </div>
    </div>
  );
}
