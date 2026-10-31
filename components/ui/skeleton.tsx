import { cn } from "cn"

// Skeletons mirror the final layout; the pulse stops under reduced motion.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
