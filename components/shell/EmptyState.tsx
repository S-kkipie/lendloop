import type { Icon } from "@phosphor-icons/react";
import { PackageIcon } from "@phosphor-icons/react/ssr";
import { cn } from "cn";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  body: string;
  /** The way out: a button or link that fixes the emptiness. */
  action?: ReactNode;
  icon?: Icon;
  className?: string;
}

/** A designed empty view: small icon, why it's empty, and what to do next. */
export function EmptyState({ title, body, action, icon: IconComponent = PackageIcon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-3 rounded-xl border border-dashed border-input bg-card px-6 py-14 text-center",
        className,
      )}
    >
      <IconComponent aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="grid gap-1">
        <h2 className="text-base font-semibold tracking-title">{title}</h2>
        <p className="max-w-[46ch] text-sm text-muted-foreground">{body}</p>
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
