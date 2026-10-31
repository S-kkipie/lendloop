import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { Show, SignInButton } from "@clerk/nextjs";
import { Suspense } from "react";
import { Kbd } from "@/components/shell/Kbd";
import { Button, ButtonLink } from "@/components/ui/button";
import { SignInShortcut } from "./SignInShortcut";

// Sign-in aware calls to action. The session is read on the server (Clerk's
// <Show> calls auth()), so the right button is in the HTML instead of flipping
// after Clerk loads in the browser. That read happens at request time, so each
// action sits in its own Suspense boundary; the fallback is the signed-out
// button, which is what most visitors to this page see anyway.

const AFTER_SIGN_IN = "/tools";

function SignInNavButton() {
  return (
    <SignInButton mode="modal" fallbackRedirectUrl={AFTER_SIGN_IN}>
      <Button variant="outline" size="sm">
        Sign in
        <Kbd className="pointer-coarse:hidden">S</Kbd>
      </Button>
    </SignInButton>
  );
}

function SignInHeroButton() {
  return (
    <SignInButton mode="modal" fallbackRedirectUrl={AFTER_SIGN_IN}>
      <Button size="lg">
        Sign in to lend or borrow
        <Kbd className="pointer-coarse:hidden">S</Kbd>
      </Button>
    </SignInButton>
  );
}

function OpenAppButton({ size, variant }: { size: "sm" | "lg"; variant: "outline" | "default" }) {
  return (
    <ButtonLink size={size} variant={variant} href={AFTER_SIGN_IN}>
      Open LendLoop
      <ArrowRightIcon aria-hidden="true" weight="bold" />
    </ButtonLink>
  );
}

/** Top bar: "Sign in [S]" for visitors, "Open LendLoop" for neighbours. */
export function NavAuthAction() {
  return (
    <Suspense fallback={<SignInNavButton />}>
      <Show when="signed-in" fallback={<SignInNavButton />}>
        <OpenAppButton size="sm" variant="outline" />
      </Show>
    </Suspense>
  );
}

/** Hero primary action. Owns the S shortcut, so it is registered once. */
export function HeroAuthAction() {
  return (
    <Suspense fallback={<SignInHeroButton />}>
      <Show
        when="signed-in"
        fallback={
          <>
            <SignInHeroButton />
            <SignInShortcut redirectUrl={AFTER_SIGN_IN} />
          </>
        }
      >
        <OpenAppButton size="lg" variant="default" />
      </Show>
    </Suspense>
  );
}
