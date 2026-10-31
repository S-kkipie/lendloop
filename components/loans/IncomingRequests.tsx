"use client";

import { CalendarCheckIcon, ClockCounterClockwiseIcon, HandshakeIcon, PlusIcon, TrayIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { rangesOverlap } from "@/convex/model/overlap";
import { EmptyState } from "@/components/shell/EmptyState";
import { Kbd } from "@/components/shell/Kbd";
import { LedgerList } from "@/components/shell/LedgerList";
import { ButtonLink } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isTerminal } from "@/convex/model/loanMachine";
import type { OverlapFacts } from "./LoanActions";
import { BoardHeader, BoardSkeleton, TabLabel, useTabParam } from "./LoanBoard";
import { LOAN_COLUMNS, LoanRow, type LoanRowData } from "./LoanRow";
import { useArrivals } from "./useArrivals";

const TITLE = "Incoming";
const DESCRIPTION = "Requests for the tools you lend. Approve them, hand tools over and confirm returns.";
// Four tabs and their counts fit a 390 px screen without scrolling.
const TRIGGER = "max-sm:gap-1 max-sm:text-[0.8125rem] max-sm:group-data-[variant=line]/tabs-list:px-2";
const TABS = ["needs-action", "upcoming", "active", "past"] as const;
type Tab = (typeof TABS)[number];

export function IncomingSkeleton() {
  return <BoardSkeleton title={TITLE} description={DESCRIPTION} tabs={4} />;
}

/** For a pending request: how many other requests it overlaps, and whether its days are already booked. */
function overlapFacts(loan: LoanRowData, all: readonly LoanRowData[]): OverlapFacts {
  let pending = 0;
  let booked = false;
  for (const other of all) {
    if (other._id === loan._id || other.tool._id !== loan.tool._id || !rangesOverlap(other, loan)) continue;
    if (other.status === "pending") pending += 1;
    if (other.status === "approved" || other.status === "active") booked = true;
  }
  return { pending, booked };
}

const byStart = (a: LoanRowData, b: LoanRowData) => a.startDate.localeCompare(b.startDate);
const byEnd = (a: LoanRowData, b: LoanRowData) => a.endDate.localeCompare(b.endDate);

const LIST_LABEL: Record<Tab, string> = {
  "needs-action": "Requests waiting for you",
  upcoming: "Approved, waiting for handover",
  active: "Out on loan",
  past: "Past requests",
};

const EMPTY: Record<Tab, { title: string; body: string; icon: typeof TrayIcon }> = {
  "needs-action": {
    title: "No requests waiting",
    body: "When a neighbour asks to borrow one of your tools, the request shows up here for you to approve or decline.",
    icon: TrayIcon,
  },
  upcoming: {
    title: "No upcoming handovers",
    body: "Requests you approve wait here until you hand the tool over.",
    icon: CalendarCheckIcon,
  },
  active: {
    title: "Nothing is out on loan",
    body: "Tools you've handed over stay here until you confirm they're back.",
    icon: HandshakeIcon,
  },
  past: {
    title: "No past loans yet",
    body: "Returned, declined, cancelled and expired requests are kept here for the record.",
    icon: ClockCounterClockwiseIcon,
  },
};

/**
 * Incoming: requests for the viewer's tools, by what they need from the
 * owner. Live: a new request slides into Needs action without a reload.
 */
export function IncomingRequests() {
  const loans = useQuery(api.loans.incoming);
  const listings = useQuery(api.tools.mine);
  const [tab, setTab] = useTabParam<Tab>(TABS, "needs-action");
  const arrivals = useArrivals(loans?.map((loan) => loan._id));

  if (loans === undefined) return <IncomingSkeleton />;

  const groups: Record<Tab, LoanRowData[]> = {
    "needs-action": loans.filter((l) => l.status === "pending").sort(byStart),
    upcoming: loans.filter((l) => l.status === "approved").sort(byStart),
    active: loans.filter((l) => l.status === "active").sort(byEnd),
    past: loans.filter((l) => isTerminal(l.status)),
  };
  const lendsNothing = loans.length === 0 && listings !== undefined && listings.every((t) => t.status === "removed");

  const listATool = (
    <ButtonLink href="/tools/new">
      <PlusIcon aria-hidden="true" weight="bold" />
      List a tool
      <Kbd className="pointer-coarse:hidden">N</Kbd>
    </ButtonLink>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description={DESCRIPTION} />

      {lendsNothing ? (
        <EmptyState
          icon={TrayIcon}
          title="You're not lending anything yet"
          body="List a tool you're happy to lend. When a neighbour asks for it, the request lands here."
          action={listATool}
        />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            arrivals.settleAll();
            setTab(value as Tab);
          }}
        >
          <TabsList aria-label="Requests by stage" className="gap-0 sm:gap-1">
            <TabsTrigger className={TRIGGER} value="needs-action">
              <TabLabel label="Needs action" count={groups["needs-action"].length} loud />
            </TabsTrigger>
            <TabsTrigger className={TRIGGER} value="upcoming">
              <TabLabel label="Upcoming" count={groups.upcoming.length} />
            </TabsTrigger>
            <TabsTrigger className={TRIGGER} value="active">
              <TabLabel label="Active" count={groups.active.length} />
            </TabsTrigger>
            <TabsTrigger className={TRIGGER} value="past">
              <TabLabel label="Past" count={groups.past.length} />
            </TabsTrigger>
          </TabsList>

          {TABS.map((value) => {
            const rows = groups[value];
            const empty = EMPTY[value];
            return (
              <TabsContent key={value} value={value}>
                {rows.length === 0 ? (
                  <EmptyState
                    icon={empty.icon}
                    title={empty.title}
                    body={empty.body}
                    action={
                      <ButtonLink href="/me/listings" variant="outline">
                        See my listings
                      </ButtonLink>
                    }
                  />
                ) : (
                  <LedgerList
                    label={LIST_LABEL[value]}
                    heads={["Tool · borrower", "Dates", "Status", "Actions"]}
                    columns={LOAN_COLUMNS}
                  >
                    {rows.map((loan) => (
                      <LoanRow
                        key={loan._id}
                        loan={loan}
                        viewer="owner"
                        overlap={loan.status === "pending" ? overlapFacts(loan, loans) : undefined}
                        arriving={arrivals.isArriving(loan._id)}
                        onArrived={() => arrivals.settle(loan._id)}
                      />
                    ))}
                  </LedgerList>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
