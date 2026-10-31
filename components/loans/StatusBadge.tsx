import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { BADGE_VARIANT_BY_TONE, loanStatusView, type CloseReason, type LoanStatus } from "@/lib/loanStatus";

interface StatusBadgeProps {
  loan: { status: LoanStatus; overdue: boolean; daysOverdue: number; closeReason?: CloseReason };
  className?: string;
}

/**
 * A loan's status as text plus tone ("Requested", "Handed over", "Overdue 3
 * days"). The label is always there; colour is the second signal, and overdue
 * is the only loud (solid) tone.
 */
export function StatusBadge({ loan, className }: StatusBadgeProps) {
  const view = loanStatusView(loan);
  const Icon = view.icon;
  return (
    <Badge variant={BADGE_VARIANT_BY_TONE[view.tone]} className={cn(className)}>
      <Icon aria-hidden="true" weight="bold" />
      {view.label}
    </Badge>
  );
}
