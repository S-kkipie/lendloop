import { CheckIcon, ClockCountdownIcon } from "@phosphor-icons/react";
import type { Availability } from "@/convex/lib/tools";
import { Badge } from "@/components/ui/badge";
import { toDayString } from "@/lib/calendarDays";
import { formatDay } from "@/lib/format";

/**
 * "Available", or "Back Nov 12" while someone has it. Once the return date
 * has passed it just says "On loan": whether a neighbour is late is between
 * them and the owner, not something Browse announces.
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
  const late = availability.until < toDayString(new Date());
  return (
    <Badge variant="warn">
      <ClockCountdownIcon aria-hidden="true" weight="bold" />
      {late ? "On loan" : <>Back {formatDay(availability.until)}</>}
    </Badge>
  );
}
