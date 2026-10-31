export interface DateRange {
  startDate: string;
  endDate: string;
}

// Inclusive ranges overlap when each starts on or before the other ends.
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function overlapping<T extends DateRange>(target: DateRange, candidates: T[]): T[] {
  return candidates.filter((candidate) => rangesOverlap(target, candidate));
}
