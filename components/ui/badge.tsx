import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Status badges always carry text; tone is a second signal, never the only one.
// "danger" (solid) is reserved for Overdue, the only loud state.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs leading-none font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary-ink",
        neutral: "bg-neutral-soft text-neutral-ink",
        info: "bg-info-soft text-info-ink",
        ok: "bg-ok-soft text-ok-ink",
        warn: "bg-warn-soft text-warn-ink",
        danger: "bg-danger text-danger-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
