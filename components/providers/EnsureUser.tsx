"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorCode, messageForError } from "@/lib/convexErrors";

export type Me = FunctionReturnType<typeof api.users.me>;

/**
 * syncing: waiting for Convex auth or users.syncMe
 * ready:   the users row exists; user queries are safe to run
 * deleted: syncMe answered FORBIDDEN (the account was deleted)
 * session: Clerk says signed in but Convex has no valid token
 *          (while Clerk says signed out, the layout's redirect is on its way,
 *          so the status stays "syncing")
 * error:   anything else (network, server); retry is offered
 */
export type UserStatus = "syncing" | "ready" | "deleted" | "session" | "error";

interface UserContextValue {
  status: UserStatus;
  me: Me | undefined;
  errorMessage: string | null;
  retry: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

type SyncState =
  | { status: "syncing" }
  | { status: "ready" }
  | { status: "deleted" }
  | { status: "error"; message: string };

/** Runs users.syncMe once per session, then exposes users.me to the app. */
export function EnsureUser({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const syncMe = useMutation(api.users.syncMe);
  const [sync, setSync] = useState<SyncState>({ status: "syncing" });
  const [attempt, setAttempt] = useState(0);
  const startedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated || startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;
    syncMe().then(
      () => setSync({ status: "ready" }),
      (error: unknown) =>
        setSync(
          errorCode(error) === "FORBIDDEN"
            ? { status: "deleted" }
            : { status: "error", message: messageForError(error) },
        ),
    );
  }, [isLoading, isAuthenticated, attempt, syncMe]);

  const sessionLost = !isLoading && !isAuthenticated && clerkLoaded && isSignedIn === true;
  const status: UserStatus = sessionLost ? "session" : sync.status;
  const me = useQuery(api.users.me, status === "ready" ? {} : "skip");

  const value: UserContextValue = {
    status,
    me,
    errorMessage: sync.status === "error" ? sync.message : null,
    retry: () => {
      setSync({ status: "syncing" });
      setAttempt((n) => n + 1);
    },
  };

  return <UserContext value={value}>{children}</UserContext>;
}

function useUserContext(): UserContextValue {
  const value = use(UserContext);
  if (!value) throw new Error("useMe must be used inside <EnsureUser>");
  return value;
}

/** The signed-in user (display name, own email, role), or undefined while loading. */
export function useMe(): Me | undefined {
  return useUserContext().me;
}

export function useUserStatus(): Pick<UserContextValue, "status" | "errorMessage" | "retry"> {
  const { status, errorMessage, retry } = useUserContext();
  return { status, errorMessage, retry };
}
