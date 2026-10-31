"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

// Quiet toasts, bottom-right, styled from the same tokens as popovers.
// Status icons carry the tone; the surface stays neutral.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="size-4 text-ok-ink" />,
        info: <InfoIcon weight="fill" className="size-4 text-info-ink" />,
        warning: <WarningIcon weight="fill" className="size-4 text-warn-ink" />,
        error: <XCircleIcon weight="fill" className="size-4 text-danger-ink" />,
        loading: (
          <SpinnerGapIcon className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans! text-sm! shadow-pop! gap-2.5!",
          title: "font-medium!",
          description: "text-muted-foreground!",
          actionButton:
            "bg-primary! text-primary-foreground! rounded-md! font-medium!",
          cancelButton: "bg-muted! text-foreground! rounded-md!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
