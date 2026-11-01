"use client"

import { animate, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef } from "react"
import { cn } from "cn"

// Magic UI NumberTicker (registry @magicui/number-ticker), adapted to Ledger:
// - counts up once, on first paint; later (live) value changes jump straight
//   to the new number, so a realtime update never replays the animation
// - server-rendered (the landing page): the HTML carries the real number, so
//   it reads right before hydration and without JS. On the client it counts
//   up only if nobody has seen it yet (it starts off-screen, and counts when
//   it scrolls into view); one already on screen keeps its number, no flash to 0
// - 600 ms with the system's --ease-out curve instead of a long spring
// - no counting under prefers-reduced-motion, or in a tab nobody is looking
//   at (requestAnimationFrame is paused there, so the count would sit on a
//   wrong number until the tab is shown)
// - the animated digits are aria-hidden; the real value is always readable
// - tabular figures and a fixed minimum width, so the text after it never shifts

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const format = (n: number) => Intl.NumberFormat("en-US").format(Math.round(n))
const noSubscription = () => () => {}

function inViewport(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight
}

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
  // false while hydrating server HTML (React uses the server snapshot), true
  // when the ticker mounts in the browser. Captured once, like the first text,
  // which React then never rewrites (the effect owns the digits).
  const mountedInBrowser = useSyncExternalStore(noSubscription, () => true, () => false)
  const [fromServer] = useState(!mountedInBrowser)
  const [firstText] = useState(() => format(fromServer ? value : startValue))

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const settle = () => {
      played.current = true
      node.textContent = format(value)
    }
    if (played.current || reduceMotion || document.visibilityState === "hidden") return settle()
    const count = () => {
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
    }
    if (!fromServer) return count()
    if (inViewport(node)) return settle()
    node.textContent = format(startValue)
    let stop: (() => void) | undefined
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      stop = count()
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      stop?.()
    }
  }, [value, startValue, delay, duration, reduceMotion, fromServer])

  return (
    <span className={cn("relative inline-block", className)} {...props}>
      <span
        ref={ref}
        aria-hidden="true"
        className="inline-block text-right tabular-nums"
        style={{ minWidth: `${format(value).length}ch`, ...style }}
      >
        {firstText}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
