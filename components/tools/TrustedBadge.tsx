import { SealCheckIcon } from "@phosphor-icons/react";
import { cn } from "cn";

/** Marks a lender an admin has vouched for. Text, not just the seal. */
export function TrustedBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary-ink", className)}>
      <SealCheckIcon aria-hidden="true" weight="fill" className="size-3.5 shrink-0" />
      {compact ? (
        <>
          Trusted<span className="sr-only"> lender</span>
        </>
      ) : (
        "Trusted lender"
      )}
    </span>
  );
}
