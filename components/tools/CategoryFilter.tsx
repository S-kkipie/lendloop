"use client";

import { SquaresFourIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { CATEGORIES, type Category } from "@/lib/categories";

const chip =
  "motion-press inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[0.8125rem] font-medium whitespace-nowrap select-none [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * Category chips (toggle buttons). One row that scrolls sideways on narrow
 * screens instead of wrapping into a wall of chips; the page itself never
 * scrolls horizontally.
 */
export function CategoryFilter({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (next: Category | null) => void;
}) {
  const options: { slug: Category | null; label: string; icon: typeof SquaresFourIcon }[] = [
    { slug: null, label: "All", icon: SquaresFourIcon },
    ...CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, icon: c.icon })),
  ];

  return (
    <div
      role="group"
      aria-label="Category"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {options.map(({ slug, label, icon: Icon }) => {
        const pressed = value === slug;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(slug)}
            className={cn(
              chip,
              pressed
                ? "border-transparent bg-primary-soft text-primary-ink"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" weight={pressed ? "bold" : "regular"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
