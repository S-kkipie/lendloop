"use client";

import { ArrowClockwiseIcon, ArrowRightIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { BoardHeader, TabLabel } from "@/components/loans/LoanBoard";
import { useMe } from "@/components/providers/EnsureUser";
import { EmptyState } from "@/components/shell/EmptyState";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminAccess, adminSearch, parseAdminParams, type AdminParams, type AdminTab } from "@/lib/admin";
import { errorCode, messageForError } from "@/lib/convexErrors";
import { AuditTab } from "./AuditTab";
import { AutomationTab } from "./AutomationTab";
import { ListingsTab } from "./ListingsTab";
import { LoansTab } from "./LoansTab";
import { TableSkeleton } from "./shared";
import { StatTiles, StatTilesSkeleton } from "./StatTiles";
import { UsersTab } from "./UsersTab";

const TITLE = "Admin";
const DESCRIPTION =
  "Moderate listings, vouch for lenders and keep an eye on the email automation. Everything you change here is written to the audit log.";
// Five tabs fit a 390 px screen without scrolling at this size.
const TRIGGER = "max-sm:gap-1 max-sm:text-[0.8125rem] max-sm:group-data-[variant=line]/tabs-list:px-2";

/** ?tab=, ?status=, ?overdue=1, ?entity=&id=: the console's state lives in the URL. */
function useAdminParams(): [AdminParams, (patch: Partial<AdminParams>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = parseAdminParams(new URLSearchParams(search.toString()));
  // Reads the live URL, so the callback stays stable across renders (the
  // audit filter debounces on it).
  const update = useCallback(
    (patch: Partial<AdminParams>) => {
      const current = parseAdminParams(new URLSearchParams(window.location.search));
      router.replace(`${pathname}${adminSearch({ ...current, ...patch })}`, { scroll: false });
    },
    [router, pathname],
  );
  return [params, update];
}

export function AdminSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6" aria-busy="true">
      <BoardHeader title={TITLE} description={DESCRIPTION} />
      <span className="sr-only" role="status">
        Loading the admin console
      </span>
      <StatTilesSkeleton />
      <div aria-hidden="true" className="grid gap-4">
        <div className="flex h-10 items-center gap-6 border-b border-border">
          {[56, 64, 48, 84, 62].map((width) => (
            <Skeleton key={width} className="h-3.5" style={{ width }} />
          ))}
        </div>
        <TableSkeleton heads={["ID", "Tool", "Owner", "Borrower", "Dates", "Status"]} columns="xl:grid-cols-6" />
      </div>
    </div>
  );
}

/** Shown to signed-in people without the admin role (the nav hides the link; the server says FORBIDDEN). */
export function AdminsOnly() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description="The admin console for LendLoop moderators." />
      <EmptyState
        icon={LockSimpleIcon}
        title="Admins only"
        body="Your account doesn't have the admin role, so there's nothing to show here. If you think it should, ask the people who run LendLoop."
        action={
          <ButtonLink href="/tools" variant="outline">
            Go to Browse
            <ArrowRightIcon aria-hidden="true" />
          </ButtonLink>
        }
      />
    </div>
  );
}

function Console() {
  const [params, update] = useAdminParams();
  const health = useQuery(api.admin.automationHealth);
  const active = useQuery(api.admin.listLoans, { status: "active" });

  // Automation asks for attention while something waits on an admin: a
  // problem nobody replayed yet, or an unresolved error.
  const waiting = health
    ? health.problems.filter((p) => p.replayedAt === null).length + health.errors.length
    : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description={DESCRIPTION} />
      {health === undefined || active === undefined ? (
        <StatTilesSkeleton />
      ) : (
        <StatTiles health={health} active={active} />
      )}

      <Tabs
        id="records"
        className="scroll-mt-20 lg:scroll-mt-6"
        value={params.tab}
        onValueChange={(value) => update({ tab: value as AdminTab })}
      >
        <TabsList aria-label="Admin records" className="gap-0 sm:gap-1">
          <TabsTrigger className={TRIGGER} value="loans">
            Loans
          </TabsTrigger>
          <TabsTrigger className={TRIGGER} value="listings">
            Listings
          </TabsTrigger>
          <TabsTrigger className={TRIGGER} value="users">
            Users
          </TabsTrigger>
          <TabsTrigger className={TRIGGER} value="automation">
            {waiting > 0 ? <TabLabel label="Automation" count={waiting} loud /> : "Automation"}
          </TabsTrigger>
          <TabsTrigger className={TRIGGER} value="audit">
            <span>
              Audit<span className="max-sm:hidden"> log</span>
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="loans">
          <LoansTab params={params} update={update} />
        </TabsContent>
        <TabsContent value="listings">
          <ListingsTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="automation">
          {health === undefined ? (
            <TableSkeleton heads={["Notification", "Problem", "Tries", "Last error", "Queued", "Actions"]} columns="xl:grid-cols-6" />
          ) : (
            <AutomationTab health={health} />
          )}
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab params={params} update={update} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LoadProblem({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description={DESCRIPTION} />
      <div role="alert" className="grid max-w-md gap-2 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold tracking-title">The console didn&apos;t load</h2>
        <p className="text-sm text-muted-foreground">{messageForError(error)}</p>
        <div className="mt-1">
          <Button size="sm" variant="outline" onClick={reset}>
            <ArrowClockwiseIcon aria-hidden="true" /> Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * /admin: stat tiles, then Loans, Listings, Users, Automation and Audit log
 * tabs. The role comes from the signed-in user's token; non-admins get
 * "Admins only" without a single admin query being sent, and a FORBIDDEN from
 * the server (a role removed mid-session) lands on the same state.
 */
export function AdminConsole() {
  const access = adminAccess(useMe());
  if (access === "loading") return <AdminSkeleton />;
  if (access === "forbidden") return <AdminsOnly />;
  return (
    <ErrorBoundary
      fallback={(error, reset) =>
        errorCode(error) === "FORBIDDEN" ? <AdminsOnly /> : <LoadProblem error={error} reset={reset} />
      }
    >
      <Console />
    </ErrorBoundary>
  );
}
