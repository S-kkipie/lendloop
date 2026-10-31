"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.closest('[role="textbox"], [role="combobox"], [role="searchbox"], [role="dialog"]') !== null;
}

/** S opens the sign-in modal when focus is not in a field or a dialog. */
export function SignInShortcut({ redirectUrl }: { redirectUrl: string }) {
  const clerk = useClerk();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key.toLowerCase() !== "s" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target) || !clerk.loaded) return;
      event.preventDefault();
      clerk.openSignIn({ fallbackRedirectUrl: redirectUrl });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clerk, redirectUrl]);

  return null;
}
