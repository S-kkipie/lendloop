"use client";

import { useState } from "react";

/**
 * Tracks which items of a live list arrived after its first paint, so only
 * those ease in (`row-arrive`, 200 ms). Items present when the data first
 * loads never animate. An arrival stays flagged until its animation ends
 * (`settle`), so re-renders don't replay it; `settleAll` drops pending
 * entrances, e.g. on a tab switch, which never animates.
 */
export function useArrivals(ids: readonly string[] | undefined) {
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(() => new Set());

  // Derived from the previous render's ids (React's "adjust state while
  // rendering" pattern): no effect, so the first frame is already right.
  if (ids !== undefined) {
    if (seen === null) {
      setSeen(new Set(ids));
    } else {
      const fresh = ids.filter((id) => !seen.has(id));
      if (fresh.length > 0) {
        setSeen(new Set([...seen, ...fresh]));
        setArriving(new Set([...arriving, ...fresh]));
      }
    }
  }

  return {
    isArriving: (id: string) => arriving.has(id),
    settle: (id: string) =>
      setArriving((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    settleAll: () => setArriving((current) => (current.size === 0 ? current : new Set())),
  };
}

export type Arrivals = ReturnType<typeof useArrivals>;
