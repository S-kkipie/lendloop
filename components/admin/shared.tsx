"use client";

import { cn } from "cn";
import { useState, type ComponentProps, type ReactNode } from "react";
import { LedgerList, LedgerRow } from "@/components/shell/LedgerList";
import { Skeleton } from "@/components/ui/skeleton";
import { shortId } from "@/lib/admin";

/**
 * The last value a live query returned, kept while new arguments load, so a
 * filter change doesn't flash the table back to skeletons.
 */
export function useKept<T>(value: T | undefined): { data: T | undefined; refreshing: boolean } {
  const [kept, setKept] = useState(value);
  if (value !== undefined && value !== kept) setKept(value);
  return { data: value ?? kept, refreshing: value === undefined && kept !== undefined };
}

/** A section of a tab: an h2 with an optional line under it, then its content. */
export function AdminSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="grid gap-1">
          <h2 id={id} className="text-base font-semibold tracking-title">
            {title}
          </h2>
          {description ? <p className="max-w-[96ch] text-[0.8125rem] leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Filters above a table, and the live count of what it shows. */
export function Toolbar({ children, summary }: { children?: ReactNode; summary: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {children}
      <p role="status" className="font-mono text-xs text-muted-foreground sm:ml-auto">
        {summary}
      </p>
    </div>
  );
}

/** A Convex ID cut to its distinctive end, with the full ID for screen readers and on hover. */
export function ShortId({ id, className }: { id: string; className?: string }) {
  return (
    <span title={id} className={cn("font-mono text-xs whitespace-nowrap text-muted-foreground", className)}>
      <span aria-hidden="true">{shortId(id)}</span>
      <span className="sr-only">ID ending {id.slice(-6)}</span>
    </span>
  );
}

/** Dense admin rows: tighter than the app's lists, with a quiet hover tint. */
export function AdminRow({ className, ...props }: ComponentProps<typeof LedgerRow>) {
  return (
    <LedgerRow
      className={cn(
        "relative items-center py-3 transition-[background-color] duration-(--dur-row) hover:bg-muted/70 xl:py-2.5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Makes a row's name link cover the whole row (pointer users click anywhere;
 * keyboard users get one tab stop and a ring around the row). Other controls
 * in the row sit above it with `relative z-10`.
 */
export const STRETCHED_LINK =
  "rounded-sm font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid";

/** A skeleton table: heads plus rows shaped like the real ones. */
export function TableSkeleton({ heads, columns, rows = 4 }: { heads: readonly string[]; columns: string; rows?: number }) {
  return (
    <div aria-hidden="true">
      <LedgerList label="Loading" heads={heads} columns={columns}>
        {Array.from({ length: rows }, (_, row) => (
          <div
            key={row}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 xl:col-span-full xl:grid-cols-subgrid xl:gap-x-6 xl:py-3"
          >
            {heads.map((_, index) =>
              index === 0 ? (
                <div key={index} className="grid gap-2 xl:block">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                  <Skeleton className="h-3 w-28 xl:hidden" />
                </div>
              ) : index === heads.length - 1 ? (
                <Skeleton key={index} className="h-6 w-20 justify-self-end rounded-md" />
              ) : (
                <Skeleton key={index} className="hidden h-3 w-16 xl:block" />
              ),
            )}
          </div>
        ))}
      </LedgerList>
    </div>
  );
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${Intl.NumberFormat("en-US").format(count)} ${count === 1 ? word : many}`;
}

const chip =
  "motion-press inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[0.8125rem] font-medium whitespace-nowrap select-none";

/** One-of-many filter as toggle buttons ("All 14", "Listed 12", "Removed 2"). */
export function ToggleChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              chip,
              pressed
                ? "border-transparent bg-primary-soft text-primary-ink"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className="font-mono text-[0.6875rem]">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
