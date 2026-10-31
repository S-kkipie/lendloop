"use client";

import { UserButton } from "@clerk/nextjs";
import { useMe } from "@/components/providers/EnsureUser";
import { Skeleton } from "@/components/ui/skeleton";

const userButtonAppearance = {
  elements: {
    avatarBox: "size-8",
    userButtonTrigger: "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  },
};

/** Clerk's account menu plus the viewer's own name and email (never anyone else's). */
export function UserMenu() {
  const me = useMe();

  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1 py-1">
      <span className="grid size-8 shrink-0 place-items-center">
        <UserButton appearance={userButtonAppearance} />
      </span>
      {me ? (
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-sm font-medium">{me.displayName}</span>
          {me.email ? <span className="truncate text-xs text-muted-foreground">{me.email}</span> : null}
        </span>
      ) : (
        <span className="grid flex-1 gap-1.5" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-32" />
        </span>
      )}
    </div>
  );
}

/** Avatar only, for the mobile top bar. */
export function UserAvatarButton() {
  return (
    <span className="grid size-10 shrink-0 place-items-center">
      <UserButton appearance={userButtonAppearance} />
    </span>
  );
}
