import Link from "next/link";
import { Wordmark } from "@/components/shell/Wordmark";
import { NavAuthAction } from "./AuthActions";

// The page has two in-page destinations and one action, so the bar stays that
// small: wordmark, two anchors, sign in. Not sticky, no rule underneath; the
// band below draws the first line on the page.
export function SiteHeader() {
  return (
    <header className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-10">
      <Link href="/" className="-mx-1.5 flex h-10 items-center rounded-md px-1.5" aria-label="LendLoop home">
        <Wordmark />
      </Link>
      <nav aria-label="On this page" className="hidden sm:block">
        <ul className="flex items-center gap-1 text-sm text-muted-foreground">
          <li>
            <a
              href="#how-it-works"
              className="rounded-md px-2.5 py-2 whitespace-nowrap transition-[color] duration-(--dur-row) hover:text-foreground"
            >
              How it works
            </a>
          </li>
          <li>
            <a
              href="#security"
              className="rounded-md px-2.5 py-2 whitespace-nowrap transition-[color] duration-(--dur-row) hover:text-foreground"
            >
              Security
            </a>
          </li>
        </ul>
      </nav>
      <div className="ml-auto">
        <NavAuthAction />
      </div>
    </header>
  );
}
