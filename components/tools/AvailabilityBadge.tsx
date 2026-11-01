import { CheckIcon, ClockCountdownIcon } from "@phosphor-icons/react";
import type { Availability } from "@/convex/lib/tools";
import { Badge } from "@/components/ui/badge";
import { toDayString } from "@/lib/calendarDays";
import { formatDay } from "@/lib/format";

/**
 * "Available", or "Back Nov 12" while someone has it. Once the return date
 * has passed it just says "On loan": whether a neighbour is late is between
 * them and the owner, not something Browse announces (Convex leaves the date
 * out for everyone else, so it may be missing).
 */
export function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === "available") {
    return (
      <Badge variant="ok">
        <CheckIcon aria-hidden="true" weight="bold" />
        Available
      </Badge>
    );
  }
  const until = availability.until;
  return (
    <Badge variant="warn">
      <ClockCountdownIcon aria-hidden="true" weight="bold" />
      {until && until >= toDayString(new Date()) ? <>Back {formatDay(until)}</> : "On loan"}
    </Badge>
  );
}
