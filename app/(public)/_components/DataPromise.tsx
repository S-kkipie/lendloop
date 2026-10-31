import type { Icon } from "@phosphor-icons/react";
import { ArrowUpRightIcon, EnvelopeSimpleIcon, EyeSlashIcon, ListChecksIcon } from "@phosphor-icons/react/ssr";
import { SECURITY_DOC_URL } from "@/lib/site";

const PROMISES: { title: string; text: string; icon: Icon }[] = [
  {
    title: "Owners stay private",
    text: "This page shows tools only. Once signed in, neighbours see a first name and an initial, like Marta R., and never your email.",
    icon: EyeSlashIcon,
  },
  {
    title: "Email is only for loan updates",
    text: "Our automation writes to you about your own requests and loans. Your address is never shown to other neighbours or shared.",
    icon: EnvelopeSimpleIcon,
  },
  {
    title: "Every action is on the record",
    text: "Requests, approvals, handovers and returns go into an audit trail that nobody can edit, admins included.",
    icon: ListChecksIcon,
  },
];

export function DataPromise() {
  return (
    <section
      id="security"
      aria-labelledby="data-title"
      className="mx-auto w-full max-w-6xl px-4 pt-24 pb-24 sm:px-6 sm:pt-32 sm:pb-32 lg:px-10"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-2 border-b border-border px-5 py-5 sm:px-6">
          <h2 id="data-title" className="text-2xl font-semibold tracking-title sm:text-3xl">
            How we handle your data
          </h2>
          <p className="max-w-[60ch] text-muted-foreground">
            LendLoop keeps what a lending board needs: who you are, what you lend and borrow, and when.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {PROMISES.map(({ title, text, icon: Icon }) => (
            <li key={title} className="grid gap-x-8 gap-y-1.5 px-5 py-5 sm:px-6 md:grid-cols-[17rem_minmax(0,1fr)]">
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-title">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-primary-ink" />
                {title}
              </h3>
              <p className="max-w-[66ch] text-[0.9375rem] leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
        {SECURITY_DOC_URL ? (
          <div className="border-t border-border bg-muted px-5 py-3 sm:px-6">
            <a
              href={SECURITY_DOC_URL}
              className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
            >
              Read the security notes on GitHub
              <ArrowUpRightIcon aria-hidden="true" weight="bold" className="size-3.5" />
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
