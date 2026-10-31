"use client";

import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { SignOutButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EnsureUser, useUserStatus } from "@/components/providers/EnsureUser";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { messageForError } from "@/lib/convexErrors";
import { CommandPaletteProvider } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { MobileNav } from "./MobileNav";
import { SidebarContent } from "./SidebarNav";
import { Wordmark } from "./Wordmark";

/** Page-shaped placeholder: title, intro line and a framed list. */
export function ContentSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden="true">
      <div className="grid gap-2.5">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="ml-auto h-5 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div role="alert" className="grid max-w-md gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <WarningCircleIcon aria-hidden="true" weight="fill" className="size-5 text-danger-ink" />
        <h1 className="text-base font-semibold tracking-title">{title}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

function MainContent({ children }: { children: ReactNode }) {
  const { status, errorMessage, retry } = useUserStatus();
  const pathname = usePathname();

  if (status === "ready") {
    return (
      <ErrorBoundary
        resetKey={pathname}
        fallback={(error, reset) => (
          <Notice title="This page didn't load" body={messageForError(error)}>
            <Button size="sm" variant="outline" onClick={reset}>
              <ArrowClockwiseIcon aria-hidden="true" /> Try again
            </Button>
          </Notice>
        )}
      >
        {children}
      </ErrorBoundary>
    );
  }
  if (status === "error") {
    return (
      <Notice title="We couldn't load your account" body={errorMessage ?? "Please try again."}>
        <Button size="sm" variant="outline" onClick={retry}>
          <ArrowClockwiseIcon aria-hidden="true" /> Try again
        </Button>
      </Notice>
    );
  }
  if (status === "session") {
    return (
      <Notice title="Your session needs a refresh" body="We couldn't confirm your sign-in with the server. Reload the page to continue.">
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          <ArrowClockwiseIcon aria-hidden="true" /> Reload
        </Button>
      </Notice>
    );
  }
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading your account
      </span>
      <ContentSkeleton />
    </div>
  );
}

function DeletedAccount() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-md gap-6">
        <Wordmark />
        <div className="grid gap-3 rounded-xl border border-border bg-card p-6">
          <h1 className="text-xl font-semibold tracking-title">This account was deleted</h1>
          <p className="text-sm text-muted-foreground">
            Your LendLoop account and its listings were removed, so it can&apos;t be used anymore. Sign out to continue
            with a different account.
          </p>
          <div>
            <SignOutButton redirectUrl="/">
              <Button>Sign out</Button>
            </SignOutButton>
          </div>
        </div>
      </div>
    </main>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { status } = useUserStatus();
  if (status === "deleted") return <DeletedAccount />;

  return (
    <CommandPaletteProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh border-r border-border bg-background lg:block">
          <SidebarContent />
        </aside>
        <div className="min-w-0">
          <MobileNav />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
            <MainContent>{children}</MainContent>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}

/** Signed-in chrome: rail or top bar, ⌘K palette, and the user sync gate. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <EnsureUser>
      <Frame>{children}</Frame>
    </EnsureUser>
  );
}
