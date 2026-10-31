"use client";

import { cn } from "cn";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimestamp, relativeTime } from "@/lib/format";

/** "now", ticking every 30 s so "just now" becomes "1 min ago" without a reload. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface RelativeTimeProps {
  at: number;
  now: number;
  /**
   * Focusable times open their tooltip from the keyboard (timelines, short
   * lists). In long tables they stay out of the tab order; the exact time is
   * still read out after the relative one.
   */
  focusable?: boolean;
  className?: string;
}

/** Relative time in mono, with the exact time in a tooltip and for screen readers. */
export function RelativeTime({ at, now, focusable = true, className }: RelativeTimeProps) {
  const exact = formatTimestamp(at);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={new Date(at).toISOString()}
            tabIndex={focusable ? 0 : undefined}
            className={cn(
              "w-fit rounded-sm font-mono text-xs whitespace-nowrap text-muted-foreground underline decoration-dotted decoration-1 underline-offset-[3px] hover:text-foreground",
              className,
            )}
          />
        }
      >
        {relativeTime(at, now)}
        <span className="sr-only">, {exact}</span>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{exact}</TooltipContent>
    </Tooltip>
  );
}
