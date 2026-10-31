import { cn } from "cn";

/** LendLoop wordmark: two linked rings (the loop), the second in cobalt. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[0.9375rem] font-semibold tracking-title", className)}>
      <svg aria-hidden="true" viewBox="0 0 22 14" className="h-3.5 w-[1.375rem] shrink-0 overflow-visible" fill="none" strokeWidth={2.5}>
        <circle cx="7" cy="7" r="5.75" className="stroke-foreground" />
        <circle cx="15" cy="7" r="5.75" className="stroke-primary" />
      </svg>
      LendLoop
    </span>
  );
}
