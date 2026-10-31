"use client"

import { animate, useReducedMotion } from "motion/react"
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { cn } from "cn"

// Magic UI NumberTicker (registry @magicui/number-ticker), adapted to Ledger:
// - counts up once, on first paint; later (live) value changes jump straight
//   to the new number, so a realtime update never replays the animation
// - 600 ms with the system's --ease-out curve instead of a long spring
// - no counting under prefers-reduced-motion, or in a tab nobody is looking
//   at (requestAnimationFrame is paused there, so the count would sit on a
//   wrong number until the tab is shown)
// - the animated digits are aria-hidden; the real value is always readable
// - tabular figures and a fixed minimum width, so the text after it never shifts

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const format = (n: number) => Intl.NumberFormat("en-US").format(Math.round(n))

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  /** Seconds before counting starts. */
  delay?: number
  /** Seconds the count takes. */
  duration?: number
}

export function NumberTicker({
  value,
  startValue = 0,
  delay = 0,
  duration = 0.6,
  className,
  style,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const played = useRef(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (played.current || reduceMotion || document.visibilityState === "hidden") {
      played.current = true
      node.textContent = format(value)
      return
    }
    const controls = animate(startValue, value, {
      duration,
      delay,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        node.textContent = format(latest)
      },
      onComplete: () => {
        played.current = true
      },
    })
    return () => controls.stop()
  }, [value, startValue, delay, duration, reduceMotion])

  return (
    <span className={cn("relative inline-block", className)} {...props}>
      <span
        ref={ref}
        aria-hidden="true"
        className="inline-block text-right tabular-nums"
        style={{ minWidth: `${format(value).length}ch`, ...style }}
      >
        {format(startValue)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
