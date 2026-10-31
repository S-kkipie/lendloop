"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useMe } from "@/components/providers/EnsureUser";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerCell, LedgerList } from "@/components/shell/LedgerList";
import { RelativeTime, useNow } from "@/components/shell/RelativeTime";
import { TrustedBadge } from "@/components/tools/TrustedBadge";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { messageForError } from "@/lib/convexErrors";
import { AdminRow, plural, TableSkeleton, Toolbar } from "./shared";

type User = FunctionReturnType<typeof api.admin.listUsers>[number];

const HEADS = ["Name", "Email", "Listings", "Joined", "Trusted lender"] as const;
const COLUMNS = "xl:grid-cols-[minmax(0,1fr)_max-content_max-content_max-content_max-content]";

function UserAdminRow({
  user,
  isMe,
  now,
  onTrust,
}: {
  user: User;
  isMe: boolean;
  now: number;
  onTrust: (user: User, trusted: boolean) => void;
}) {
  const nameId = useId();
  const switchId = useId();
  const email = user.maskedEmail ?? "No email on file";

  return (
    <AdminRow aria-labelledby={nameId}>
      <LedgerCell className="col-start-1 row-start-1 grid content-start">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span id={nameId} className="text-sm leading-6 font-medium [overflow-wrap:anywhere]">
            {user.displayName}
          </span>
          {isMe ? <Badge variant="outline">You</Badge> : null}
          {user.isTrustedLender ? <TrustedBadge compact className="xl:hidden" /> : null}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-5 text-muted-foreground xl:hidden">
          <span className="font-mono text-xs [overflow-wrap:anywhere]">{email}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(user.listings, "listing")}</span>
          <span aria-hidden="true">·</span>
          <span>
            joined <RelativeTime at={user.joinedAt} now={now} focusable={false} className="no-underline" />
          </span>
        </p>
      </LedgerCell>
      <LedgerCell className="hidden font-mono text-xs text-muted-foreground xl:block">{email}</LedgerCell>
      <LedgerCell className="hidden font-mono text-xs xl:block">
        {user.listings}
        <span className="sr-only"> active {user.listings === 1 ? "listing" : "listings"}</span>
      </LedgerCell>
      <LedgerCell className="hidden xl:block">
        <RelativeTime at={user.joinedAt} now={now} focusable={false} />
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 flex items-center gap-2 self-start justify-self-end xl:col-start-auto xl:row-start-auto xl:self-center">
        <label htmlFor={switchId} className="sr-only">
          Trusted lender: {user.displayName}
        </label>
        <Switch id={switchId} checked={user.isTrustedLender} onCheckedChange={(checked) => onTrust(user, checked)} />
      </LedgerCell>
    </AdminRow>
  );
}

/**
 * People on LendLoop (deleted accounts are anonymized and left out). Emails
 * are masked by the server; the Trusted lender switch updates at once and
 * rolls back if the server says no.
 */
export function UsersTab() {
  const users = useQuery(api.admin.listUsers);
  const me = useMe();
  const now = useNow();
  const setTrusted = useMutation(api.admin.setTrustedLender).withOptimisticUpdate((store, { userId, trusted }) => {
    const current = store.getQuery(api.admin.listUsers, {});
    if (current === undefined) return;
    store.setQuery(
      api.admin.listUsers,
      {},
      current.map((u) => (u._id === userId ? { ...u, isTrustedLender: trusted } : u)),
    );
  });

  async function trust(user: User, trusted: boolean) {
    try {
      await setTrusted({ userId: user._id, trusted });
      toast.success(trusted ? `${user.displayName} is a trusted lender` : `${user.displayName} is no longer a trusted lender`, {
        description: trusted ? "Their listings show the Trusted lender seal." : "The seal is gone from their listings.",
      });
    } catch (error) {
      // Convex drops the optimistic value on failure, so the switch flips back.
      toast.error(`${user.displayName} wasn't updated`, { description: messageForError(error) });
    }
  }

  if (users === undefined) {
    return (
      <div className="grid gap-4">
        <Toolbar summary="Loading people" />
        <TableSkeleton heads={HEADS} columns={COLUMNS} />
      </div>
    );
  }

  const trustedCount = users.filter((u) => u.isTrustedLender).length;

  return (
    <div className="grid gap-4">
      <Toolbar summary={`${plural(users.length, "person", "people")}, ${plural(trustedCount, "trusted lender")}`}>
        <p className="max-w-[60ch] text-[0.8125rem] leading-5 text-muted-foreground">
          Trust lenders you can vouch for. Their listings get a seal neighbours can see.
        </p>
      </Toolbar>
      {users.length === 0 ? (
        <EmptyState icon={UsersThreeIcon} title="Nobody here yet" body="People appear here after they sign in for the first time." />
      ) : (
        <LedgerList label="People" heads={HEADS} columns={COLUMNS} semantics="table">
          {users.map((user) => (
            <UserAdminRow key={user._id} user={user} isMe={user._id === me?.id} now={now} onTrust={trust} />
          ))}
        </LedgerList>
      )}
    </div>
  );
}
