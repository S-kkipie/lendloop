"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { useState, useSyncExternalStore } from "react";
import type { DateRange, DayButtonProps, Modifiers } from "react-day-picker";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  bookedRangeOn,
  daysInclusive,
  fromDayString,
  overlapsBooked,
  shiftDay,
  toDayString,
  type DayRange,
} from "@/lib/calendarDays";
import { formatDay, formatRange } from "@/lib/format";

export interface DaySelection {
  start: string;
  /** null while only the first day is picked (a one-day loan until extended). */
  end: string | null;
}

interface DateRangePickerProps {
  value: DaySelection | null;
  onChange: (next: DaySelection | null) => void;
  /** Approved and active loans: dates only, never who has them. */
  booked: readonly DayRange[];
  /** First day a loan may start ("YYYY-MM-DD"). */
  firstDay: string;
  maxDays: number;
  /** Ties the calendar to an outside label and error. */
  "aria-describedby"?: string;
}

const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Two months from 768 px, one below. */
function useTwoMonths(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** What a screen reader hears for each day ("Wednesday, November 18, 2026, unavailable, booked"). */
function dayLabel(date: Date, modifiers: Modifiers): string {
  const parts = [longDate.format(date)];
  if (modifiers.today) parts.unshift("Today");
  if (modifiers.booked) parts.push("unavailable, booked");
  else if (modifiers.disabled) parts.push("unavailable");
  if (modifiers.range_start && modifiers.range_end) parts.push("your only day");
  else if (modifiers.range_start) parts.push("first day of your dates");
  else if (modifiers.range_end) parts.push("last day of your dates");
  else if (modifiers.range_middle) parts.push("in your dates");
  return parts.join(", ");
}

// Booked days stay focusable (aria-disabled, not disabled), so keyboard and
// screen reader users meet them and hear why they can't be picked, instead of
// focus silently skipping over them.
function DayButton(props: DayButtonProps) {
  const booked = Boolean(props.modifiers.booked);
  return (
    <CalendarDayButton
      {...props}
      aria-disabled={booked || undefined}
      className={booked ? `${props.className ?? ""} aria-disabled:pointer-events-auto` : props.className}
    />
  );
}

/**
 * Range calendar for a loan request. Past days are disabled; booked days are
 * struck through and refuse selection with a reason. A range that would cross
 * a booking, or run longer than `maxDays`, starts over from the day just
 * picked, and says so.
 */
export function DateRangePicker({
  value,
  onChange,
  booked,
  firstDay,
  maxDays,
  "aria-describedby": describedBy,
}: DateRangePickerProps) {
  const twoMonths = useTwoMonths();
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const first = fromDayString(firstDay);
  const bookedMatchers = booked.map((range) => ({
    from: fromDayString(range.startDate),
    to: fromDayString(range.endDate),
  }));
  const selected: DateRange | undefined = value
    ? { from: fromDayString(value.start), to: value.end ? fromDayString(value.end) : undefined }
    : undefined;

  function handleSelect(range: DateRange | undefined, trigger: Date, modifiers: Modifiers) {
    const day = toDayString(trigger);
    if (modifiers.booked) {
      setNotice(`${formatDay(day)} is booked. Pick a free day.`);
      return;
    }
    if (!range?.from) {
      setNotice(null);
      onChange(null);
      return;
    }
    const start = toDayString(range.from);
    const end = range.to ? toDayString(range.to) : null;
    if (end && overlapsBooked(start, end, booked)) {
      setNotice(`Those dates cross a booking, so your selection starts again from ${formatDay(day)}.`);
      onChange({ start: day, end: null });
      return;
    }
    if (end && daysInclusive(start, end) > maxDays) {
      setNotice(`Loans can be at most ${maxDays} days, so your selection starts again from ${formatDay(day)}.`);
      onChange({ start: day, end: null });
      return;
    }
    setNotice(null);
    onChange({ start, end });
  }

  function showReason(date: Date, modifiers: Modifiers) {
    if (!modifiers.booked) {
      setHint(null);
      return;
    }
    const range = bookedRangeOn(toDayString(date), booked);
    setHint(range ? `Booked ${formatRange(range.startDate, range.endDate)}` : "Booked");
  }

  return (
    <div className="grid gap-3">
      <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3.5 rounded-xs bg-primary" />
          Selected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-grid size-3.5 place-items-center rounded-xs bg-muted font-mono text-[0.5625rem] leading-none line-through">
            9
          </span>
          Booked
        </span>
      </div>

      <Calendar
        mode="range"
        resetOnSelect
        showOutsideDays={false}
        selected={selected}
        onSelect={handleSelect}
        numberOfMonths={twoMonths ? 2 : 1}
        defaultMonth={selected?.from ?? first}
        startMonth={first}
        endMonth={fromDayString(shiftDay(firstDay, 365))}
        disabled={{ before: first }}
        modifiers={{ booked: bookedMatchers }}
        modifiersClassNames={{
          booked:
            "[&>button]:cursor-not-allowed [&>button]:bg-muted [&>button]:text-muted-foreground [&>button]:line-through [&>button]:decoration-muted-foreground/70 [&>button]:hover:bg-muted",
        }}
        labels={{ labelDayButton: dayLabel }}
        onDayFocus={showReason}
        onDayMouseEnter={showReason}
        onDayMouseLeave={() => setHint(null)}
        onDayBlur={() => setHint(null)}
        components={{ DayButton }}
        aria-describedby={describedBy}
        className="w-full p-0 md:w-fit"
        classNames={{
          root: "w-full md:w-fit",
          // Past days fade; the strike-through is reserved for booked days.
          disabled: "text-muted-foreground opacity-45",
        }}
      />

      <div className="min-h-5 text-xs">
        {/* One persistent live region, so every new notice is announced. */}
        <p role="status" className={notice ? "flex items-start gap-1.5 text-danger-ink" : "sr-only"}>
          {notice ? (
            <>
              <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-px size-3.5 shrink-0" />
              {notice}
            </>
          ) : null}
        </p>
        {notice ? null : (
          <p aria-hidden="true" className="font-mono text-muted-foreground">
            {hint ?? "\u00a0"}
          </p>
        )}
      </div>
    </div>
  );
}
