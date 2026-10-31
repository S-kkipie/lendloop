import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import Link from "next/link"
import type { ComponentProps } from "react"

// Ledger buttons: 8 px radius, hairline outline, one cobalt fill, press scale
// 0.97 (motion-press). Hover only under a fine pointer (see globals.css).
const buttonVariants = cva(
  "motion-press group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap select-none disabled:pointer-events-none aria-disabled:pointer-events-none aria-busy:cursor-progress aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover not-disabled:[&_kbd]:bg-primary-foreground/15 not-disabled:[&_kbd]:text-primary-foreground not-disabled:[&_kbd]:shadow-none disabled:bg-muted disabled:text-muted-foreground aria-disabled:bg-muted aria-disabled:text-muted-foreground",
        outline:
          "border-border bg-card text-foreground hover:bg-accent aria-expanded:bg-accent disabled:bg-muted disabled:text-muted-foreground aria-disabled:bg-muted aria-disabled:text-muted-foreground",
        secondary:
          "bg-muted text-foreground hover:bg-accent aria-expanded:bg-accent disabled:text-muted-foreground aria-disabled:text-muted-foreground",
        ghost:
          "text-foreground hover:bg-accent aria-expanded:bg-accent data-popup-open:bg-accent disabled:text-muted-foreground aria-disabled:text-muted-foreground",
        destructive:
          "bg-danger text-danger-foreground hover:bg-danger-hover not-disabled:[&_kbd]:bg-danger-foreground/15 not-disabled:[&_kbd]:text-danger-foreground not-disabled:[&_kbd]:shadow-none disabled:bg-muted disabled:text-muted-foreground aria-disabled:bg-muted aria-disabled:text-muted-foreground",
        link: "h-auto! rounded-sm px-0! py-0.5! text-primary-ink underline-offset-4 hover:underline disabled:text-muted-foreground",
      },
      size: {
        default: "h-9 px-3.5 py-1.5 text-sm",
        xs: "h-7 gap-1.5 rounded-md px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 py-1 text-[0.8125rem]",
        lg: "h-10 px-4 py-2 text-[0.9375rem]",
        icon: "size-9",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/**
 * A link that looks like a button. Navigation stays a real link (role "link",
 * middle-click, prefetch); `<Button render={<Link />}>` would announce it as a
 * button instead.
 */
function ButtonLink({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, ButtonLink, buttonVariants }
