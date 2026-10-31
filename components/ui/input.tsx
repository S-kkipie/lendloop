import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

// Shared field chrome for inputs, textareas and select triggers.
const fieldClasses =
  "w-full min-w-0 rounded-lg border border-input bg-card text-base text-foreground transition-[border-color] duration-(--dur-row) placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-danger-ink aria-invalid:focus-visible:outline-danger-ink md:text-sm"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        "h-9 px-3 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldClasses }
