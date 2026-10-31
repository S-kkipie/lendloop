import Link from "next/link";
import { useId } from "react";
import type { Availability } from "@/convex/lib/tools";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryLabel } from "@/lib/categories";
import { conditionLabel } from "@/lib/conditions";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { CategoryIcon } from "./CategoryIcon";
import { TrustedBadge } from "./TrustedBadge";

export interface ToolCardData {
  name: string;
  /** null only in the listing form's preview, before one is chosen. */
  category: string | null;
  condition: string | null;
  isMine: boolean;
  owner: { displayName: string; isTrustedLender: boolean };
  availability: Availability;
}

interface ToolCardProps {
  tool: ToolCardData;
  /** Ledger number shown in mono ("007"). */
  number: string;
  /** Destination; without it the card is a static preview (the listing form). */
  href?: string;
}

const frame =
  "group/tool-card relative grid h-full grid-rows-[auto_1fr_auto] gap-3 rounded-xl border border-border bg-card p-4";

/** One tool in the Browse grid: ledger number, name, facts, lender, availability. */
export function ToolCard({ tool, number, href }: ToolCardProps) {
  const nameId = useId();

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted-foreground">{number}</span>
        <AvailabilityBadge availability={tool.availability} />
      </div>
      <div className="grid content-start gap-1.5">
        <h2 id={nameId} className="line-clamp-2 text-[0.9375rem] leading-snug font-semibold tracking-title [overflow-wrap:anywhere]">
          {tool.name}
        </h2>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
          {tool.category ? (
            <>
              <CategoryIcon category={tool.category} aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{categoryLabel(tool.category)}</span>
            </>
          ) : (
            <span>Category</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{tool.condition ? conditionLabel(tool.condition) : "Condition"}</span>
        </p>
      </div>
      <div className="flex min-h-6 items-center gap-2 border-t border-border pt-3 text-[0.8125rem]">
        {tool.isMine ? (
          <Badge variant="neutral">Yours</Badge>
        ) : (
          <>
            <span className="truncate text-foreground">{tool.owner.displayName}</span>
            {tool.owner.isTrustedLender ? <TrustedBadge compact /> : null}
          </>
        )}
      </div>
    </>
  );

  if (!href) {
    return <div className={frame}>{body}</div>;
  }

  return (
    <Link
      href={href}
      aria-labelledby={nameId}
      className={`${frame} transition-[border-color,background-color] duration-(--dur-row) hover:border-input hover:bg-accent/40`}
    >
      {body}
    </Link>
  );
}

export function ToolCardSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-6 w-20 rounded-md" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="border-t border-border pt-3">
        <Skeleton className="h-3.5 w-24" />
      </div>
    </div>
  );
}
