"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Ledger tabs: a hairline rule with a 2 px cobalt bar under the active tab.
// Tab changes are instant (arrow keys switch them; no slide, no fade).
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-4 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list flex items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        line: "w-full gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]",
        segmented: "inline-flex w-fit gap-0.5 rounded-lg bg-muted p-1",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  }
)

type ScrollEdges = "none" | "start" | "end" | "both"

/**
 * Which edges of a scrolling strip hide content. Measured (not a CSS scroll
 * timeline: Chrome reports a strip with nothing to scroll as fully scrolled).
 */
function useScrollEdges(ref: React.RefObject<HTMLDivElement | null>): ScrollEdges {
  const [edges, setEdges] = React.useState<ScrollEdges>("none")
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      const start = el.scrollLeft > 1
      const end = el.scrollLeft < max - 1
      setEdges(max <= 1 ? "none" : start && end ? "both" : start ? "start" : "end")
    }
    update()
    // Tabs change width when a count appears; the strip when the screen turns.
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [ref])
  return edges
}

function TabsList({
  className,
  variant = "line",
  ref,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const localRef = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(localRef)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-scroll-edges={variant === "line" && edges !== "none" ? edges : undefined}
      className={cn(tabsListVariants({ variant }), className)}
      ref={(node: HTMLDivElement | null) => {
        localRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color] duration-(--dur-row) hover:text-foreground focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:-mb-px group-data-[variant=line]/tabs-list:h-10 group-data-[variant=line]/tabs-list:px-2.5 group-data-[variant=line]/tabs-list:py-2 group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:bg-primary group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        "group-data-[variant=segmented]/tabs-list:h-7 group-data-[variant=segmented]/tabs-list:rounded-md group-data-[variant=segmented]/tabs-list:px-2.5 group-data-[variant=segmented]/tabs-list:py-1 group-data-[variant=segmented]/tabs-list:data-active:bg-card group-data-[variant=segmented]/tabs-list:data-active:shadow-thumb",
        className
      )}
      {...props}
    />
  )
}

/** Mono count chip for a tab label, e.g. "Needs action 2". */
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm bg-primary-soft px-1 py-[3px] font-mono text-[0.6875rem] leading-none font-medium text-primary-ink",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-w-0 flex-1 text-sm focus-visible:outline-offset-4", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsCount, TabsContent, tabsListVariants }
