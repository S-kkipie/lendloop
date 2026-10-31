import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "LendLoop", template: "%s · LendLoop" },
  description: "Borrow what you need. Lend what you don't.",
};

// Single light theme (user decision 2026-10-31). Paper colour, oklch(99.3% 0.002 260).
export const viewport: Viewport = {
  themeColor: "#fcfdfe",
  colorScheme: "light",
};

// Clerk reads the same CSS variables as the app, so its components share the
// Ledger palette without a second copy of it.
const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorDanger: "var(--danger-ink)",
    colorSuccess: "var(--ok-ink)",
    colorWarning: "var(--warn-ink)",
    colorNeutral: "var(--foreground)",
    colorForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorInput: "var(--card)",
    colorInputForeground: "var(--foreground)",
    colorRing: "var(--ring)",
    colorBorder: "var(--border)",
    colorModalBackdrop: "var(--backdrop)",
    fontFamily: "var(--font-plex-sans)",
    fontFamilyButtons: "var(--font-plex-sans)",
    fontFamilyMono: "var(--font-plex-mono)",
    borderRadius: "0.5rem",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
        <body className="min-h-dvh">
          <ConvexClientProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
