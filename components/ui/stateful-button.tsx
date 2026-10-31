"use client"

import type { ComponentProps, ReactNode } from "react"
import { CheckIcon, SpinnerGapIcon } from "@phosphor-icons/react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

export type ActionState = "idle" | "loading" | "success"

interface StatefulButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  state: ActionState
  labels: { idle: ReactNode; loading: string; success: string }
  /** Icon shown with the idle label. */
  icon?: ReactNode
}

// A submit button that turns into its own progress and result
// (idle → "Sending…" → "Requested"). The three labels share one grid cell, so
// the width never jumps, and swap with a short blurred crossfade
// (`motion-swap`). It never goes grey while busy: clicks are ignored by the
// caller while `state` is not idle, and aria-busy marks the wait.
export function StatefulButton({ state, labels, icon, className, ...props }: StatefulButtonProps) {
  const layers: { key: ActionState; content: ReactNode }[] = [
    { key: "idle", content: <>{icon}{labels.idle}</> },
    {
      key: "loading",
      content: (
        <>
          <SpinnerGapIcon aria-hidden="true" className="animate-spin" />
          {labels.loading}
        </>
      ),
    },
    {
      key: "success",
      content: (
        <>
          <CheckIcon aria-hidden="true" weight="bold" />
          {labels.success}
        </>
      ),
    },
  ]

  return (
    <Button aria-busy={state === "loading" || undefined} className={cn("grid", className)} {...props}>
      {layers.map((layer) => (
        <span
          key={layer.key}
          data-hidden={layer.key !== state}
          aria-hidden={layer.key !== state || undefined}
          className="motion-swap col-start-1 row-start-1 inline-flex items-center justify-center gap-2"
        >
          {layer.content}
        </span>
      ))}
      <span className="sr-only" role="status">
        {state === "idle" ? "" : state === "loading" ? labels.loading : labels.success}
      </span>
    </Button>
  )
}
