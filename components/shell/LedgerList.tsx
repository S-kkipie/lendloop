import { cn } from "cn";
import { createContext, use, type AnimationEvent, type ComponentProps, type ReactNode } from "react";

/**
 * "list" (default): rows are list items and the column heads are decoration.
 * "table": the same layout exposed as an ARIA table (rows, column headers,
 * cells), for dense records like the admin console. Every direct child of a
 * table row must then be a LedgerCell.
 */
type Semantics = "list" | "table";
const SemanticsContext = createContext<Semantics>("list");

interface LedgerListProps {
  /** Accessible name of the list ("Requests waiting for you"). */
  label: string;
  /** Column heads, shown from xl up, where rows become a table. */
  heads: readonly ReactNode[];
  /**
   * The xl column template, e.g. "xl:grid-cols-[minmax(0,1fr)_max-content]".
   * Rows are subgrids of it, so columns line up across rows.
   */
  columns: string;
  children: ReactNode;
  className?: string;
  semantics?: Semantics;
  /** The last column holds actions and aligns right (default); false for a text column. */
  endAligned?: boolean;
}

/**
 * The Ledger list: a framed stack of hairline rows. Below xl every row is a
 * stacked card-row; from xl up the rows share one grid (subgrid) and read as a
 * table with mono column heads on surface 2.
 */
export function LedgerList({ label, heads, columns, children, className, semantics = "list", endAligned = true }: LedgerListProps) {
  const table = semantics === "table";
  return (
    <SemanticsContext value={semantics}>
      <div
        role={table ? "table" : "list"}
        aria-label={label}
        data-loan-list=""
        tabIndex={-1}
        className={cn(
          "grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card focus-visible:outline-offset-2 xl:gap-x-6",
          columns,
          className,
        )}
      >
        <div
          aria-hidden={table ? undefined : "true"}
          role={table ? "row" : undefined}
          className="hidden h-9 items-center bg-muted px-4 font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-muted-foreground xl:col-span-full xl:grid xl:grid-cols-subgrid"
        >
          {heads.map((head, index) => (
            <span
              key={index}
              role={table ? "columnheader" : undefined}
              className={cn("whitespace-nowrap", endAligned && index === heads.length - 1 && index > 0 && "text-right")}
            >
              {head}
            </span>
          ))}
        </div>
        {children}
      </div>
    </SemanticsContext>
  );
}

interface LedgerRowProps extends ComponentProps<"div"> {
  /** Eases the row in once (it arrived live, after the first paint). */
  arriving?: boolean;
  onArrived?: () => void;
}

/** One row of a LedgerList. Two columns when stacked; the list's columns from xl up. */
export function LedgerRow({ arriving, onArrived, className, children, ...props }: LedgerRowProps) {
  const semantics = use(SemanticsContext);
  return (
    <div
      role={semantics === "table" ? "row" : "listitem"}
      data-loan-row=""
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] content-start gap-x-3 px-4 py-3.5 xl:col-span-full xl:grid-cols-subgrid xl:gap-x-6",
        arriving && "row-arrive",
        className,
      )}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onArrived?.();
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/** A cell of a table-semantics LedgerList row (a plain div in a list). */
export function LedgerCell({ className, ...props }: ComponentProps<"div">) {
  const semantics = use(SemanticsContext);
  return <div role={semantics === "table" ? "cell" : undefined} className={cn("min-w-0", className)} {...props} />;
}
