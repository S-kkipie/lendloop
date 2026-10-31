"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import type { FunctionReturnType } from "convex/server";
import { cn } from "cn";
import Link from "next/link";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import { useNow } from "@/components/shell/RelativeTime";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { COUNT_CAP, heartbeatView, undelivered } from "@/lib/admin";
import { plural } from "./shared";

type Health = FunctionReturnType<typeof api.admin.automationHealth>;
type Loan = FunctionReturnType<typeof api.admin.listLoans>[number];

const FRAME = "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-5";

function Tile({
  href,
  label,
  value,
  caption,
  danger = false,
  className,
}: {
  href: string;
  label: string;
  value: ReactNode;
  caption: string;
  danger?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group/tile relative grid content-start gap-1 bg-card px-4 py-3.5 transition-[background-color] duration-(--dur-row) hover:bg-muted focus-visible:-outline-offset-2",
        className,
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-xs font-medium", danger ? "text-danger-ink" : "text-muted-foreground")}>
        {danger ? <WarningCircleIcon aria-hidden="true" weight="fill" className="size-3.5 shrink-0" /> : null}
        <span>
          {label}
          {danger ? <span className="sr-only">, needs attention</span> : null}
        </span>
      </span>
      <span
        className={cn(
          "text-[1.75rem] leading-9 font-semibold tracking-title tabular-nums",
          danger ? "text-danger-ink" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-xs leading-4 text-muted-foreground">{caption}</span>
    </Link>
  );
}

/** The tile strip while its two queries load: same frame, same heights. */
export function StatTilesSkeleton() {
  return (
    <div aria-hidden="true" className={FRAME}>
      {[0, 1, 2, 3, 4].map((tile) => (
        <div key={tile} className={cn("grid gap-2.5 bg-card px-4 py-3.5", tile === 4 && "col-span-2 lg:col-span-1")}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/**
 * Five numbers that tell an admin whether anything needs them: loans out and
 * overdue, notifications still on their way to n8n, dead letters waiting for a
 * replay, and whether the reminder workflow is still running. Each tile opens
 * the tab that explains it. Counts tick up once on first paint; live changes
 * jump straight to the new value.
 */
export function StatTiles({ health, active }: { health: Health; active: readonly Loan[] }) {
  const now = useNow();
  const overdue = active.filter((loan) => loan.overdue).length;
  const queued = undelivered(health.counts);
  const retrying = health.counts.retrying ?? 0;
  const dead = health.counts.dead ?? 0;
  // A replayed dead letter stays dead (the replay is a new event). Count the
  // ones nobody has replayed; anything beyond the 25 listed counts as waiting.
  const replayedDead = health.problems.filter((p) => p.status === "dead" && p.replayedAt !== null).length;
  const waiting = Math.max(dead - replayedDead, 0);
  const beat = heartbeatView(health.heartbeat.lastCheckInAt, health.heartbeat.stale, now);
  const capped = (count: number) => (count >= COUNT_CAP ? `${plural(count, "event")} or more` : null);

  return (
    <section aria-label="At a glance" className={FRAME}>
      <Tile
        href="/admin?status=active#records"
        label="Active loans"
        value={<NumberTicker value={active.length} />}
        caption="Handed over, not back yet"
      />
      <Tile
        href="/admin?overdue=1#records"
        label="Overdue"
        value={<NumberTicker value={overdue} />}
        caption={overdue > 0 ? "Borrowers get a daily email" : "Everything is due back later"}
        danger={overdue > 0}
      />
      <Tile
        href="/admin?tab=automation#records"
        label="Undelivered"
        value={<NumberTicker value={queued} />}
        caption={
          capped(queued) ??
          (queued === 0 ? "Every email reached n8n" : retrying > 0 ? `${retrying} retrying with backoff` : "On their way to n8n")
        }
      />
      <Tile
        href="/admin?tab=automation#records"
        label="Dead letters"
        value={<NumberTicker value={dead} />}
        caption={
          waiting > 0
            ? `${waiting} waiting for a replay`
            : dead > 0
              ? "All replayed"
              : "Nothing stuck"
        }
        danger={waiting > 0}
      />
      <Tile
        href="/admin?tab=automation#heartbeat"
        label="Reminder heartbeat"
        value={<span className="text-xl leading-9">{beat.value}</span>}
        caption={beat.caption}
        danger={beat.danger}
        className="col-span-2 lg:col-span-1"
      />
    </section>
  );
}
