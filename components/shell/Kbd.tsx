"use client";

import { cn } from "cn";
import { useSyncExternalStore, type ComponentProps } from "react";

const subscribeNever = () => () => {};

function detectApple(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

/** True on macOS and iOS. The server render assumes Apple; the client corrects it. */
export function useIsApple(): boolean {
  return useSyncExternalStore(subscribeNever, detectApple, () => true);
}

/** A mono key hint. Styling lives on the kbd element in globals.css. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd data-slot="kbd" className={cn(className)} {...props} />;
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere, with a spoken label. */
export function ModKbd({ keyName, className }: { keyName: string; className?: string }) {
  const apple = useIsApple();
  return (
    <Kbd className={className}>
      <span aria-hidden="true">{apple ? `⌘${keyName}` : `Ctrl ${keyName}`}</span>
      <span className="sr-only">{apple ? `Command ${keyName}` : `Control ${keyName}`}</span>
    </Kbd>
  );
}
