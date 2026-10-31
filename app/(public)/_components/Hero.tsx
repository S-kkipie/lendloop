import { ArrowDownIcon } from "@phosphor-icons/react/ssr";
import { buttonVariants } from "@/components/ui/button";
import { HeroAuthAction } from "./AuthActions";

/** Left-aligned, content-height hero: the promise, one line of how, one action. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mx-auto w-full max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
      <h1
        id="hero-title"
        className="max-w-[14ch] min-w-0 text-[clamp(2.5rem,1.6rem+4vw,4.25rem)] leading-[1.02] font-semibold tracking-display [overflow-wrap:anywhere] md:max-w-none"
      >
        {/* One sentence per line from md up; free wrapping below. */}
        <span className="md:block">Borrow what you need.</span> <span className="md:block">Lend what you don&apos;t.</span>
      </h1>
      <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
        A lending board for your street. Every request, handover and return on the record.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <HeroAuthAction />
        {/* A plain anchor, so the jump uses the page's CSS smooth scrolling. */}
        <a href="#register" className={buttonVariants({ size: "lg", variant: "ghost" })}>
          Browse tools
          <ArrowDownIcon aria-hidden="true" weight="bold" />
        </a>
      </div>
    </section>
  );
}
