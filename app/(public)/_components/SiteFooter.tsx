import { REPO_URL, SECURITY_DOC_URL } from "@/lib/site";

const linkClass =
  "rounded-sm whitespace-nowrap underline-offset-4 transition-[color] duration-(--dur-row) hover:text-foreground hover:underline";

/** One hairline, one line of mono: name, what it is, where to read more. */
export function SiteFooter() {
  const links = [
    { href: "#how-it-works", label: "How it works" },
    { href: "#security", label: "Privacy" },
    ...(SECURITY_DOC_URL ? [{ href: SECURITY_DOC_URL, label: "Security" }] : []),
    ...(REPO_URL ? [{ href: REPO_URL, label: "GitHub" }] : []),
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 font-mono text-xs text-muted-foreground sm:px-6 lg:px-10">
        <p>
          <span className="text-foreground">LendLoop</span> · a lending board for your street
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {links.map((link) => (
              <li key={link.label}>
                <a href={link.href} className={linkClass}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
