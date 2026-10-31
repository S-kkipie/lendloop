import type { ComponentPropsWithoutRef, CSSProperties, ElementType } from "react"
import { cn } from "cn"

// Magic UI BlurFade (registry @magicui/blur-fade), rebuilt on a CSS animation
// (`.blur-fade` in globals.css): it plays at first paint, off the main thread,
// without waiting for hydration, which a JS-driven entrance cannot do on a
// server-rendered page. Each element animates once, when it mounts.
// - opacity + 4 px rise + 4 px blur, 300 ms --ease-out
// - stagger: `index` x 40 ms, capped so the whole sequence stays short
// - reduced motion keeps the fade and drops the rise and the blur
// - polymorphic (`as`), so table rows and list items can fade in place

const MAX_STAGGER_STEPS = 10

type BlurFadeProps<T extends ElementType> = {
  as?: T
  /** Position in the sequence; 0 starts immediately. */
  index?: number
} & Omit<ComponentPropsWithoutRef<T>, "as">

export function BlurFade<T extends ElementType = "div">({
  as,
  index = 0,
  className,
  style,
  ...props
}: BlurFadeProps<T>) {
  const Tag: ElementType = as ?? "div"
  return (
    <Tag
      className={cn("blur-fade", className)}
      style={{ "--blur-fade-index": Math.min(Math.max(index, 0), MAX_STAGGER_STEPS), ...style } as CSSProperties}
      {...props}
    />
  )
}
