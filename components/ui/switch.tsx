"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-[color,background-color,border-color] duration-(--dur-pop) after:absolute after:-inset-x-2 after:-inset-y-2.5 data-checked:bg-primary data-unchecked:bg-(--switch-off) data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:outline-danger-ink",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-px rounded-full bg-(--switch-thumb) shadow-thumb transition-transform duration-(--dur-pop) ease-out data-checked:translate-x-[17px] data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
