"use client";

import { ArrowRightIcon, HandshakeIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId } from "react";
import { api } from "@/convex/_generated/api";
import { StatusBadge } from "@/components/loans/StatusBadge";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerCell, LedgerList } from "@/components/shell/LedgerList";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LOAN_STATUS_FILTERS, type AdminParams } from "@/lib/admin";
import { dayCount, formatRange } from "@/lib/format";
import { loanStatusView, type LoanStatus } from "@/lib/loanStatus";
import { cn } from "cn";
import { AdminRow, plural, ShortId, STRETCHED_LINK, TableSkeleton, Toolbar, useKept } from "./shared";

type Loan = FunctionReturnType<typeof api.admin.listLoans>[number];

const HEADS = ["ID", "Tool", "Owner", "Borrower", "Dates", "Status"] as const;
const COLUMNS = "xl:grid-cols-[max-content_minmax(0,1fr)_max-content_max-content_max-content_max-content]";

type StatusChoice = LoanStatus | "all";
const statusLabel = (status: LoanStatus) => loanStatusView({ status, overdue: false, daysOverdue: 0 }).label;
const STATUS_ITEMS = [
  { value: "all" as StatusChoice, label: "All statuses" },
  ...LOAN_STATUS_FILTERS.map((status) => ({ value: status as StatusChoice, label: statusLabel(status) })),
];

function LoanAdminRow({ loan }: { loan: Loan }) {
  const nameId = useId();
  return (
    <AdminRow aria-labelledby={nameId}>
      <LedgerCell className="hidden xl:block">
        <ShortId id={loan._id} />
      </LedgerCell>
      <LedgerCell className="col-start-1 row-start-1 grid content-start xl:col-start-auto xl:row-start-auto xl:block">
        <Link id={nameId} href={`/loans/${loan._id}`} className={cn(STRETCHED_LINK, "w-fit text-sm leading-6")}>
          {loan.tool.name}
        </Link>
        {/* Below xl the row stacks: who, then the mono facts. */}
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-5 text-muted-foreground xl:hidden">
          <span>{loan.owner.displayName}</span>
          <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0" />
          <span className="sr-only">lends to</span>
          <span>{loan.borrower.displayName}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs leading-5 text-muted-foreground xl:hidden">
          <ShortId id={loan._id} />
          <span aria-hidden="true">·</span>
          <span className="text-foreground">{formatRange(loan.startDate, loan.endDate)}</span>
        </p>
      </LedgerCell>
      <LedgerCell className="hidden truncate text-[0.8125rem] xl:block">{loan.owner.displayName}</LedgerCell>
      <LedgerCell className="hidden truncate text-[0.8125rem] xl:block">{loan.borrower.displayName}</LedgerCell>
      <LedgerCell className="hidden font-mono text-xs whitespace-nowrap xl:block">
        {formatRange(loan.startDate, loan.endDate)}
        <span className="text-muted-foreground"> · {dayCount(loan.startDate, loan.endDate)}</span>
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 flex self-start justify-self-end xl:col-start-auto xl:row-start-auto xl:self-center">
        <StatusBadge loan={loan} />
      </LedgerCell>
    </AdminRow>
  );
}

function summaryFor(count: number, params: AdminParams): string {
  if (params.overdue) return `${plural(count, "overdue loan")}`;
  if (params.status) return `${plural(count, "loan")} ${statusLabel(params.status).toLowerCase()}`;
  return `${plural(count, "loan")}, newest first`;
}

/**
 * Every loan, newest first, filtered on the server by status or "overdue
 * only" (handed over and past its end date). A row opens the loan's timeline.
 */
export function LoansTab({ params, update }: { params: AdminParams; update: (patch: Partial<AdminParams>) => void }) {
  const statusId = useId();
  const overdueId = useId();
  const args = params.overdue ? { overdueOnly: true } : params.status ? { status: params.status } : {};
  const { data: loans, refreshing } = useKept(useQuery(api.admin.listLoans, args));
  const filtered = params.overdue || params.status !== null;

  return (
    <div className="grid gap-4">
      <Toolbar summary={loans ? summaryFor(loans.length, params) : "Loading loans"}>
        <div className="flex items-center gap-2.5">
          <span id={statusId} className="sr-only">
            Status
          </span>
          <Select<StatusChoice>
            value={params.overdue ? "active" : (params.status ?? "all")}
            onValueChange={(value) => update({ status: value === "all" ? null : value, overdue: false })}
            items={STATUS_ITEMS}
            disabled={params.overdue}
          >
            <SelectTrigger size="sm" aria-labelledby={statusId} className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label htmlFor={overdueId} className="flex cursor-pointer items-center gap-2.5 text-sm font-medium select-none">
          <Switch id={overdueId} checked={params.overdue} onCheckedChange={(checked) => update({ overdue: checked, status: null })} />
          Overdue only
        </label>
      </Toolbar>

      {loans === undefined ? (
        <TableSkeleton heads={HEADS} columns={COLUMNS} />
      ) : loans.length === 0 ? (
        <EmptyState
          icon={HandshakeIcon}
          title={params.overdue ? "Nothing is overdue" : filtered ? "No loans with this status" : "No loans yet"}
          body={
            params.overdue
              ? "Every tool that's out is due back later. Overdue loans show up here the day after their end date."
              : filtered
                ? "Try another status, or show every loan."
                : "Loans appear here as soon as a neighbour requests a tool."
          }
          action={
            filtered ? (
              <Button variant="outline" onClick={() => update({ status: null, overdue: false })}>
                Show all loans
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div aria-busy={refreshing || undefined} className={cn(refreshing && "opacity-60 transition-opacity duration-(--dur-row)")}>
          <LedgerList label="Loans" heads={HEADS} columns={COLUMNS} semantics="table">
            {loans.map((loan) => (
              <LoanAdminRow key={loan._id} loan={loan} />
            ))}
          </LedgerList>
        </div>
      )}
    </div>
  );
}
