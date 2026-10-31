"use client";

import { CalendarCheckIcon, ClockCounterClockwiseIcon, HandshakeIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isTerminal } from "@/convex/model/loanMachine";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerList } from "@/components/shell/LedgerList";
import { ButtonLink } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BoardHeader, BoardSkeleton, TabLabel, useTabParam } from "./LoanBoard";
import { LOAN_COLUMNS, LoanRow, type LoanRowData } from "./LoanRow";
import { useArrivals } from "./useArrivals";

const TITLE = "My requests";
const DESCRIPTION = "Everything you've asked to borrow, from the first request to the return.";
// Four tabs and their counts fit a 390 px screen without scrolling.
const TRIGGER = "max-sm:gap-1 max-sm:text-[0.8125rem] max-sm:group-data-[variant=line]/tabs-list:px-2";
const TABS = ["upcoming", "active", "past"] as const;
type Tab = (typeof TABS)[number];

export function MyRequestsSkeleton() {
  return <BoardSkeleton title={TITLE} description={DESCRIPTION} tabs={3} />;
}

const byStart = (a: LoanRowData, b: LoanRowData) => a.startDate.localeCompare(b.startDate);
const byEnd = (a: LoanRowData, b: LoanRowData) => a.endDate.localeCompare(b.endDate);

const LIST_LABEL: Record<Tab, string> = {
  upcoming: "Requested and approved",
  active: "Borrowed right now",
  past: "Past requests",
};

const EMPTY: Record<Tab, { title: string; body: string; icon: typeof CalendarCheckIcon }> = {
  upcoming: {
    title: "Nothing booked",
    body: "Requests you send wait here for the owner's answer, and stay until the handover.",
    icon: CalendarCheckIcon,
  },
  active: {
    title: "You're not borrowing anything",
    body: "Once an owner hands a tool over, it shows here with its return date.",
    icon: HandshakeIcon,
  },
  past: {
    title: "No past requests yet",
    body: "Returned, declined, cancelled and expired requests are kept here for the record.",
    icon: ClockCounterClockwiseIcon,
  },
};

/** My requests: what the viewer asked to borrow, by stage. Live. */
export function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  const [tab, setTab] = useTabParam<Tab>(TABS, "upcoming");
  const arrivals = useArrivals(loans?.map((loan) => loan._id));

  if (loans === undefined) return <MyRequestsSkeleton />;

  const groups: Record<Tab, LoanRowData[]> = {
    upcoming: loans.filter((l) => l.status === "pending" || l.status === "approved").sort(byStart),
    active: loans.filter((l) => l.status === "active").sort(byEnd),
    past: loans.filter((l) => isTerminal(l.status)),
  };

  const browse = (
    <ButtonLink href="/tools">
      <MagnifyingGlassIcon aria-hidden="true" />
      Browse tools
    </ButtonLink>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <BoardHeader title={TITLE} description={DESCRIPTION} />

      {loans.length === 0 ? (
        <EmptyState
          icon={PaperPlaneTiltIcon}
          title="You haven't asked for anything yet"
          body="Find a tool in Browse, pick your days and send a request. You'll follow it here."
          action={browse}
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
            <TabsTrigger className={TRIGGER} value="upcoming">
              <TabLabel label="Upcoming" count={groups.upcoming.length} />
            </TabsTrigger>
            <TabsTrigger className={TRIGGER} value="active">
              {/* Overdue is the one state that needs the borrower: flag the tab. */}
              <TabLabel label="Active" count={groups.active.length} loud={groups.active.some((l) => l.overdue)} />
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
                      <ButtonLink href="/tools" variant="outline">
                        Browse tools
                      </ButtonLink>
                    }
                  />
                ) : (
                  <LedgerList label={LIST_LABEL[value]} heads={["Tool · lender", "Dates", "Status", "Actions"]} columns={LOAN_COLUMNS}>
                    {rows.map((loan) => (
                      <LoanRow
                        key={loan._id}
                        loan={loan}
                        viewer="borrower"
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
