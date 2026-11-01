import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { badgeVariants } from "@/components/ui/badge";
import { BADGE_VARIANT_BY_TONE, loanStatusView, type LoanStatus } from "@/lib/loanStatus";

type Stamp = { label: string; variant: NonNullable<Parameters<typeof badgeVariants>[0]>["variant"] };

function statusStamp(status: LoanStatus): Stamp {
  const view = loanStatusView({ status, overdue: false, daysOverdue: 0 });
  return { label: view.label, variant: BADGE_VARIANT_BY_TONE[view.tone] };
}

// Each step names the states it leaves on the record, with the same badges
// the app uses, so the page previews the product's own vocabulary.
const STEPS: { verb: string; text: string; stamps: Stamp[] }[] = [
  {
    verb: "List",
    text: "Add a tool you're happy to lend, with its condition and a line about it.",
    stamps: [{ label: "Available", variant: "ok" }],
  },
  {
    verb: "Request",
    text: "A neighbour picks free days on its calendar, and you approve or decline.",
    stamps: [statusStamp("pending"), statusStamp("approved")],
  },
  {
    verb: "Return",
    text: "Hand it over, get it back, mark it returned. Reminders go out by email when something is overdue.",
    stamps: [statusStamp("active"), statusStamp("returned")],
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="mx-auto grid w-full max-w-6xl gap-8 px-4 pt-24 sm:px-6 sm:pt-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12 lg:px-10"
    >
      <div className="grid content-start gap-3">
        <h2 id="how-it-works-title" className="text-2xl font-semibold tracking-title sm:text-3xl">
          How it works
        </h2>
        <p className="max-w-[46ch] text-muted-foreground">
          Three steps, each one written down, so nobody has to remember who has the ladder.
        </p>
      </div>

      <ol className="border-y border-border">
        {STEPS.map((step, index) => (
          <li
            key={step.verb}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border py-5 first:border-t-0 sm:grid-cols-[2.5rem_6.5rem_minmax(0,1fr)] sm:gap-x-4 xl:grid-cols-[2.5rem_6.5rem_minmax(0,1fr)_auto]"
          >
            <span aria-hidden="true" className="pt-0.5 font-mono text-xs text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="text-base font-semibold tracking-title">
              <span className="sr-only">Step {index + 1}: </span>
              {step.verb}
            </h3>
            <p className="col-start-2 text-[0.9375rem] leading-relaxed text-muted-foreground sm:col-start-3 sm:row-start-1">
              {step.text}
            </p>
            {/* aria-label is not allowed on a <p>: the spoken version is sr-only text. */}
            <p className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 xl:col-start-4 xl:row-start-1 xl:justify-end">
              <span className="sr-only">Shows as {step.stamps.map((s) => s.label).join(", then ")}</span>
              {step.stamps.map((stamp, stampIndex) => (
                <span key={stamp.label} className="inline-flex items-center gap-1.5" aria-hidden="true">
                  {stampIndex > 0 ? <ArrowRightIcon weight="bold" className="size-3 text-muted-foreground" /> : null}
                  <span className={badgeVariants({ variant: stamp.variant })}>{stamp.label}</span>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
