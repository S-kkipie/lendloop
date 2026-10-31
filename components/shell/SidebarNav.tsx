"use client";

import { cn } from "cn";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { useMe, useUserStatus } from "@/components/providers/EnsureUser";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommandPalette } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { Kbd, ModKbd } from "./Kbd";
import { isActive, NAV_ITEMS } from "./nav";
import { UserMenu } from "./UserMenu";
import { Wordmark } from "./Wordmark";

function IncomingCount() {
  const incoming = useQuery(api.loans.incoming);
  const pending = incoming?.filter((loan) => loan.status === "pending").length ?? 0;
  if (pending === 0) return null;
  return (
    <span className="ml-auto inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm bg-primary-soft px-1 py-[3px] font-mono text-[0.6875rem] leading-none font-medium text-primary-ink">
      {pending}
      <span className="sr-only"> pending {pending === 1 ? "request" : "requests"}</span>
    </span>
  );
}

/** Primary navigation; shared by the desktop rail and the mobile sheet. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const me = useMe();
  const { status } = useUserStatus();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === "admin");

  return (
    <nav aria-label="Main">
      <ul className="grid gap-0.5">
        {items.map(({ href, label, icon: Icon, showsIncomingCount }) => {
          const active = isActive(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-[color,background-color,border-color] duration-(--dur-row) hover:bg-accent hover:text-foreground focus-visible:outline-offset-[-2px]",
                  active && "bg-muted text-foreground",
                )}
              >
                {/* 2 px cobalt inset bar marks the current page. */}
                <span
                  aria-hidden="true"
                  className={cn("absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary", active ? "opacity-100" : "opacity-0")}
                />
                <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                {label}
                {showsIncomingCount && status === "ready" ? (
                  <ErrorBoundary fallback={() => null}>
                    <IncomingCount />
                  </ErrorBoundary>
                ) : null}
              </Link>
            </li>
          );
        })}
        {status === "syncing" ? (
          <li aria-hidden="true" className="flex h-9 items-center px-2.5">
            <Skeleton className="h-3 w-20" />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/** Everything in the rail: wordmark, search, primary action, nav, user. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { setOpen } = useCommandPalette();

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-3 py-4">
      <Link
        href="/tools"
        onClick={onNavigate}
        className="flex h-9 w-fit items-center rounded-md px-2.5 py-2 focus-visible:outline-offset-0"
        aria-label="LendLoop, browse tools"
      >
        <Wordmark />
      </Link>

      <div className="grid gap-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 px-2.5 font-normal text-muted-foreground hover:text-foreground"
          onClick={() => {
            onNavigate?.();
            setOpen(true);
          }}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
          Search
          <ModKbd keyName="K" className="ml-auto pointer-coarse:hidden" />
        </Button>
        <Button
          className="w-full justify-start gap-2 px-2.5"
          render={<Link href="/tools/new" onClick={onNavigate} />}
          nativeButton={false}
        >
          <PlusIcon aria-hidden="true" weight="bold" />
          List a tool
          <Kbd className="ml-auto pointer-coarse:hidden">N</Kbd>
        </Button>
      </div>

      <SidebarNav onNavigate={onNavigate} />

      <div className="mt-auto border-t border-border pt-3">
        <UserMenu />
      </div>
    </div>
  );
}
