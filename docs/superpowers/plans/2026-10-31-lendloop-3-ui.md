# LendLoop Plan 3: UI ("Ledger" direction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks also use the `hallmark`, `emil-design-eng` and `impeccable` skills for craft and review.

**Goal:** The complete LendLoop interface on top of the Convex API from Plans 1–2: a public landing page with the live register of available tools, the signed-in app (browse, tool detail with range calendar, my listings, my requests, incoming requests, loan timeline), the admin console (loans, moderation, trusted lenders, automation health, audit log), keyboard navigation, and light/dark themes, in the approved "B · Ledger" direction.

**Architecture:** App Router with two route groups: `(public)` for `/` and `(app)` for everything behind sign-in. `(app)/layout.tsx` is a server component that calls `auth.protect()` (UX redirect only) and renders the client `AppShell`, which gates children behind `EnsureUser` (runs `users.syncMe` once, then exposes `users.me`). Data comes from Convex hooks (`useQuery`/`useMutation`), so lists update live. Pure helpers (`lib/`) are unit-tested; screens are verified by rendering at 390 px and 1280 px, running the impeccable detector, and (Plan 4) Playwright + axe.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 + shadcn/ui (CLI 4.x, CSS variables), IBM Plex Sans/Mono via `next/font/google`, `@phosphor-icons/react`, `sonner`, `motion`, `next-themes`, `cmdk` (via shadcn Command), react-day-picker (via shadcn Calendar), `@paper-design/shaders-react` 0.0.82 (Dithering band), Magic UI `NumberTicker` and `BlurFade` (via shadcn registry).

**Spec:** `docs/superpowers/specs/2026-10-31-lendloop-design.md` §9 (UI), §6 (function surface), §8 (data minimization in what we display). Visual reference: `design/directions.html`, tab B.

## Global Constraints

- Direction B · Ledger. Tokens in OKLCH on `:root` and `.dark`; IBM Plex Sans (display 600, tracking −0.04em; UI 400/500) and IBM Plex Mono (IDs, dates, counts, `kbd`). Radii: button 8 px, card 10 px, badge 6 px. 1 px hairlines; shadows only on popovers and dialogs. One accent: cobalt (button fill must pass WCAG AA with white text in both themes).
- Icons: Phosphor only (remove lucide from shadcn components as they are added). No emoji. No em dashes in any UI copy. English UI.
- Other people are shown as display names ("Marta R."). Never render emails except the viewer's own (user menu) and admin's masked emails.
- Motion (Emil): no animation on keyboard-triggered actions or the ⌘K palette; button press `scale(0.97)` 140 ms; popovers 160 ms origin-aware; dialogs 200 ms centered; easings `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`; nothing over 300 ms in the app; hover effects only under `(hover: hover) and (pointer: fine)`; `prefers-reduced-motion` keeps opacity, drops movement; the Dithering band is static (`speed={0}`) under reduced motion and paused off-screen.
- States for every data view: skeleton while `useQuery` returns `undefined`; designed empty state with an action; `ConvexError` codes mapped to human messages (toast for actions, inline for forms).
- Confirmations only for actions with side effects (approve that auto-declines others, removals, cancel of an approved booking). Everything else acts immediately with a quiet toast.
- Accessibility: WCAG AA in both themes; visible 2 px focus ring that appears instantly; heading levels never skip; calendar fully keyboard-operable with per-day `aria-label` ("Nov 18, unavailable"); status never conveyed by color alone.
- Mobile: no horizontal scroll at 390 px; sidebar becomes a sheet; tables become stacked rows.
- Every screen passes `impeccable detect` (or each remaining finding is triaged and disclosed) and is checked visually at 390 px and 1280 px in both themes before its task is committed.

---

## File map

```
app/globals.css                         tokens (light/dark), base, motion tokens
app/layout.tsx                          fonts, ThemeProvider, ClerkProvider, ConvexClientProvider, Toaster
app/(public)/page.tsx                   landing (server: preloadQuery listPublic)
app/(public)/_components/*              Hero, DitherBand (client, dynamic), AvailableRegister (client), HowItWorks, DataPromise, SiteFooter
app/(app)/layout.tsx                    auth.protect() + AppShell
app/(app)/tools/page.tsx                browse
app/(app)/tools/new/page.tsx            create
app/(app)/tools/[id]/page.tsx           detail + request
app/(app)/tools/[id]/edit/page.tsx      edit
app/(app)/me/listings/page.tsx
app/(app)/me/requests/page.tsx
app/(app)/me/incoming/page.tsx
app/(app)/loans/[id]/page.tsx           timeline
app/(app)/admin/page.tsx                admin console (tabs)
components/shell/*                      AppShell, SidebarNav, MobileNav, UserMenu, CommandPalette, ThemeToggle, Kbd
components/providers/EnsureUser.tsx     syncMe gate + MeContext
components/loans/*                      StatusBadge, LoanRow, LoanActions, Timeline, DateRangePicker
components/tools/*                      ToolCard, ToolForm, CategoryFilter, AvailabilityBadge, TrustedBadge
components/admin/*                      StatTiles, LoansTable, ListingsTable, UsersTable, AutomationPanel, AuditTable
components/ui/*                         shadcn components (customized), magicui NumberTicker/BlurFade
lib/format.ts        + lib/format.test.ts        dates and relative time
lib/loanStatus.ts    + lib/loanStatus.test.ts    status → label/tone/next action
lib/convexErrors.ts  + lib/convexErrors.test.ts  error code → message
lib/categories.ts    + lib/categories.test.ts    category labels/icons
DESIGN.md                                        locked design system (hallmark "lock the system")
```

Vitest: add `lib/**/*.test.ts` to the `node` project include.

---

### Task 1: Design system foundation

**Files:** `components.json` (shadcn), `app/globals.css`, `app/layout.tsx`, `lib/utils.ts`, `DESIGN.md`, `vitest.config.mts`.

- [ ] Run `pnpm dlx shadcn@4 init` (Tailwind v4, CSS variables, base color neutral, `components/ui`, `lib/utils`). Then `pnpm add @phosphor-icons/react sonner motion next-themes @paper-design/shaders-react@0.0.82`. Add shadcn components: `button input label textarea select badge card dialog alert-dialog popover tooltip tabs table sheet skeleton separator dropdown-menu command calendar switch sonner`. Replace every `lucide-react` import in `components/ui` with the Phosphor equivalent, then `pnpm remove lucide-react` (if the calendar or another component insists on lucide, keep a tiny local adapter and note it).
- [ ] Write the Ledger tokens into `app/globals.css` under shadcn's variable names (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--ring`, …) plus LendLoop tokens. Light (from `design/directions.html` direction B): paper `oklch(99.3% 0.002 260)`, surface `oklch(100% 0 0)`, surface-2 `oklch(97.6% 0.004 260)`, ink `oklch(19% 0.012 262)`, muted `oklch(51% 0.012 262)`, hairline `oklch(91.5% 0.005 262)`, accent/primary `oklch(46% 0.19 263)`, accent-soft `oklch(95% 0.03 263)`, status tones (info, ok, warn, danger) as in the mockup. Dark: near-black cool neutral (`oklch(17% 0.01 262)` background, `oklch(21% 0.012 262)` surface), hairline `oklch(30% 0.012 262)`, primary lightened to `oklch(68% 0.15 263)` with dark text (`oklch(17% 0.01 262)`) for AA. Radii tokens, `--ease-out`, `--ease-in-out`, `--dur-press: 140ms`, `--dur-pop: 160ms`, `--dur-dialog: 200ms`. Global `:focus-visible` ring (2 px, `--ring`, no transition). `@media (prefers-reduced-motion: reduce)` resets transforms.
- [ ] `app/layout.tsx`: `IBM_Plex_Sans` (400/500/600) and `IBM_Plex_Mono` (400/500) from `next/font/google` as CSS variables mapped to `--font-sans` / `--font-mono`; wrap with `ThemeProvider` (`next-themes`, `attribute="class"`, `defaultTheme="system"`), `ClerkProvider` (appearance variables mapped to the tokens), `ConvexClientProvider`, `<Toaster />` (Sonner, positioned bottom-right, themed). Title "LendLoop", description "Borrow what you need. Lend what you don't."
- [ ] Customize shadcn defaults to the system (button radius 8, press scale, cobalt primary, ghost/outline variants with hairlines; badge radius 6; card radius 10 with hairline and no shadow).
- [ ] Use the `hallmark` skill's "lock the system" flow to write `DESIGN.md` from these tokens (genre: modern-minimal; direction B · Ledger; tokens; type; motion; component rules; anti-patterns to avoid).
- [ ] Verify: `pnpm build` succeeds; a temporary `/styleguide` route (deleted before commit) renders buttons, inputs, badges, card, dialog in both themes and passes `impeccable detect http://localhost:3000/styleguide`. Commit `feat(ui): add Ledger design tokens, fonts, theme and shadcn base`.

### Task 2: Pure UI helpers (TDD)

**Files:** `lib/format.ts`, `lib/loanStatus.ts`, `lib/convexErrors.ts`, `lib/categories.ts` with tests; `vitest.config.mts` (`lib/**/*.test.ts` in the `node` project).

- [ ] `formatRange("2026-11-08", "2026-11-12") → "Nov 8 to Nov 12"`; same month/year handling (`"Nov 30 to Dec 2"`, `"Dec 30, 2026 to Jan 2, 2027"` across years); `formatDay("2026-11-18") → "Nov 18"`; `relativeTime(at, now)` → "just now", "5 min ago", "2 hours ago", "2 days ago", then `formatDay`; `dayCount(start, end)` → "3 days" / "1 day". Dates are parsed as UTC calendar days (never shifted by the browser time zone).
- [ ] `loanStatusView({ status, overdue, daysOverdue, closeReason }) → { label, tone, icon }` with labels Requested, Approved, Handed over, Returned, Declined, Cancelled, Expired, and "Overdue N days" (tone `danger`) when `overdue`; `closeReasonText(reason)` for timeline/detail ("Dates were taken by another booking", "Listing was removed", …); `nextActionsFor(viewer: "owner"|"borrower", status)` → which buttons to show (`approve`, `decline`, `handOver`, `markReturned`, `cancel`).
- [ ] `messageForError(error: unknown) → string`: reads `ConvexError.data.code/message`; uses the server message for `INVALID`/`CONFLICT` (they are written for users), fixed copy for `UNAUTHENTICATED` ("Please sign in again."), `FORBIDDEN` ("You can't do that."), `NOT_FOUND` ("This item no longer exists."), `RATE_LIMITED` ("Too many attempts. Try again in a few minutes."), fallback "Something went wrong. Please try again."
- [ ] `CATEGORIES` labels ("Power tools", "Hand tools", "Garden", "Kitchen", "Camping", "Cleaning", "Ladders", "Other") and Phosphor icon per category; `categoryLabel(slug)`.
- [ ] Table-driven tests for all of the above. Commit `feat(ui): add tested formatting, status, error and category helpers`.

### Task 3: App shell, auth gate, navigation

**Files:** `app/(app)/layout.tsx`, `components/providers/EnsureUser.tsx`, `components/shell/{AppShell,SidebarNav,MobileNav,UserMenu,ThemeToggle,Kbd,CommandPalette}.tsx`.

- [ ] `(app)/layout.tsx` (server): `await auth.protect()` then `<AppShell>{children}</AppShell>`.
- [ ] `EnsureUser`: on mount calls `users.syncMe` once; renders a shell skeleton until done; provides `useMe()` (from `users.me`). On `FORBIDDEN` (deleted account) shows a full-page message with sign-out.
- [ ] Desktop sidebar rail (240 px; wordmark; Browse `/tools`, My listings `/me/listings`, My requests `/me/requests`, Incoming `/me/incoming` with a mono count of pending requests from `loans.incoming`, Admin `/admin` only when `me.role === "admin"`; bottom: theme toggle, `UserButton`). Active link: ink text + 2 px cobalt inset bar. Mobile: top bar + `Sheet` with the same nav.
- [ ] `CommandPalette` (shadcn Command in a Dialog, opens on ⌘K/Ctrl+K, no open/close animation): sections Navigate (all nav items), Tools (live search over `tools.browse({ search })`, debounced 150 ms), Actions ("List a tool" → `/tools/new`). Global shortcut `N` (when focus is not in an input) → `/tools/new`. `Kbd` component renders mono hints; show `⌘K` hint in the sidebar.
- [ ] Verify at 390/1280 in both themes; keyboard-only navigation works; impeccable clean. Commit `feat(ui): add app shell, user sync gate, navigation and command palette`.

### Task 4: Landing page (public)

**Files:** `app/(public)/page.tsx`, `app/(public)/_components/*`.

- [ ] Server component: `preloadQuery(api.tools.listPublic, {})` and pass to the client `AvailableRegister` (`usePreloadedQuery`, live). Top bar: wordmark, "How it works" and "Security" anchors, `SignInButton` (mode modal) labelled "Sign in" with `kbd S`; when signed in, show "Open LendLoop" → `/tools` instead (Clerk `<SignedIn>/<SignedOut>`).
- [ ] Hero (left-aligned): H1 "Borrow what you need. Lend what you don't." (display 600, tight tracking, max 2 lines desktop); subcopy ≤ 20 words ("A lending board for your street. Every request, handover and return on the record."); primary "Sign in to lend or borrow" with `kbd S` (keyboard `S` opens sign-in when focus is not in a field); secondary ghost "Browse tools" (scrolls to the register).
- [ ] `DitherBand`: client-only (`next/dynamic`, `ssr: false`) Paper `Dithering` (`colorBack` = paper, `colorFront` = cobalt, `shape: "warp"`, `type: "4x4"`, `size: 2.5`, `speed: 0.25`; `speed: 0` under reduced motion; pause via IntersectionObserver when off-screen; `aria-hidden`; static CSS gradient fallback behind it; height 120 px; `minPixelRatio={1}`).
- [ ] `AvailableRegister`: hairline-framed ledger table, header row "N tools available right now" (NumberTicker on first paint only) + mono "updated live"; columns No. (mono, zero-padded row index), Tool, Category (label); first-paint BlurFade 40 ms stagger, once; empty state "Nothing is free to borrow right now. Check back soon."; skeleton rows while loading. Name and category only (the query returns nothing else).
- [ ] `HowItWorks`: three ledger rows (List, Request, Return) with one sentence each and a mono step glyph, not cards. Include the automation sentence ("Reminders go out by email when something is overdue.").
- [ ] `DataPromise` ("How we handle your data"): three rows: "Owners stay private" (public page shows tools only; neighbours see first names), "Email is only for loan updates" (sent by our automation, never shared), "Every action is on the record" (audit trail). Link to the GitHub security docs.
- [ ] `SiteFooter`: hairline, mono small text, links (How it works, Privacy, Security, GitHub).
- [ ] Verify at 390/1280 both themes, reduced motion, impeccable + hallmark slop test on the page. Commit `feat(ui): add public landing with live register of available tools`.

### Task 5: Browse, tool detail, create and edit

**Files:** `app/(app)/tools/page.tsx`, `tools/new`, `tools/[id]`, `tools/[id]/edit`, `components/tools/*`, `components/loans/DateRangePicker.tsx`.

- [ ] Browse: toolbar with search (debounced 200 ms, synced to `?q=`), category chips (synced to `?category=`, "All" default), "Available only" switch (`?available=1`); responsive grid (1/2/3/4 columns) of `ToolCard` (mono No., name, category label + icon, condition, owner display name + `TrustedBadge`, `AvailabilityBadge` "Available" or "Back Nov 12"; "Yours" marker when `isMine`). Skeleton grid; empty states for "no tools yet" (CTA List a tool) and "no matches" (Clear filters).
- [ ] Detail: two columns desktop (details left, booking panel right), stacked mobile. Details: name (H1), category, condition, description, owner + trusted badge. Booking panel (not shown to the owner): `DateRangePicker` (shadcn Calendar `mode="range"`, 2 months ≥ 768 px else 1, `disabled` = past days + every day inside `bookedRanges`, booked days styled struck-through with legend "Booked" and "Selected", `aria-label` per day including "unavailable"; selecting a range that crosses a booked day resets the selection with an inline message), summary ("Nov 18 to Nov 20 · 3 days"), optional message `Textarea` (counter 0/300), submit button with idle → loading → success states ("Request dates" → "Sending…" → "Requested") then navigate to `/me/requests`. Errors inline via `messageForError`. Owner view: Edit, Remove (AlertDialog; disabled with tooltip "On loan until Nov 12" when on loan) and a link "See requests for this tool" → `/me/incoming`. Removed tool (owner/admin only): banner with the removal reason.
- [ ] `ToolForm` (create/edit): labels above inputs, helper text, errors below, name counter (3–60), category `Select` with icons, condition `Select`, description `Textarea` (≤ 500 with counter). Submit disables while pending; success toast and redirect to the tool page.
- [ ] Verify; commit `feat(ui): add browse, tool detail with booking calendar, and listing forms`.

### Task 6: My listings, my requests, incoming

**Files:** `app/(app)/me/*`, `components/loans/{StatusBadge,LoanRow,LoanActions}.tsx`.

- [ ] `StatusBadge` from `loanStatusView` (text always present; overdue is the only loud tone).
- [ ] My listings: table (desktop) / stacked rows (mobile): tool, category, availability, pending requests count (links to incoming), status (Listed/Removed with reason), actions (Edit, Remove with AlertDialog; Remove disabled with reason when `canDelete` is false). Empty state CTA "List your first tool".
- [ ] My requests: tabs Upcoming (pending + approved), Active (active), Past (terminal); rows show tool, owner display name, dates (mono), status badge, "View" → `/loans/[id]`; Cancel (pending: immediate with Undo-free toast; approved: AlertDialog "Cancel this booking? Marta will be told."). Overdue rows show the badge and a short line "Please arrange the return with Marta."
- [ ] Incoming: tabs Needs action (pending; count in tab), Upcoming (approved), Active, Past. Pending row: borrower display name, dates, message (if any, muted, max 3 lines), conflicts warning ("Overlaps 1 other request. Approving declines it.") and buttons Approve (AlertDialog only when `conflicts > 0`) / Decline. Approved row: Hand over (always enabled while the booking has not ended, matching `loans.handOver`; label shows the start date, e.g. "Hand over · starts Nov 18"), Cancel booking (AlertDialog). Active row: Mark returned (AlertDialog "Confirm you have the drill back?"). New rows arriving live animate in (200 ms opacity + 4 px), only after first paint.
- [ ] Verify; commit `feat(ui): add my listings, my requests and incoming requests`.

### Task 7: Loan timeline

**Files:** `app/(app)/loans/[id]/page.tsx`, `components/loans/Timeline.tsx`.

- [ ] Header: tool name, dates (mono), status badge, counterpart display name, primary next action for the viewer (same `LoanActions`).
- [ ] Vertical rail; entries from `loans.timeline`: status changes ("Requested by Ana L.", "Approved by Marta R.", "Handed over", "Returned", "Declined: dates taken", "Expired: start date passed"), notifications ("Email to Marta queued" / "Email to Marta sent" / "Email to you failed, retrying"; admins also see the error text), reminders ("Reminder sent to Ana" / "Reminder failed"). Automation entries use a distinct icon and tinted dot. Relative time with absolute time in a tooltip (mono). Next expected step as a dashed entry ("Marta confirms the handover", "Ana returns the drill by Nov 12").
- [ ] NOT_FOUND → friendly "This loan doesn't exist or isn't yours." Verify; commit `feat(ui): add loan timeline with automation activity`.

### Task 8: Admin console

**Files:** `app/(app)/admin/page.tsx`, `components/admin/*`, Magic UI `number-ticker` and `blur-fade` via `pnpm dlx shadcn@4 add @magicui/number-ticker @magicui/blur-fade`.

- [ ] Non-admin (FORBIDDEN from Convex) → "Admins only" state (the nav already hides the link).
- [ ] Stat tiles (NumberTicker on first paint only): Active loans, Overdue (danger tone when > 0), Undelivered notifications (pending + retrying), Dead letters (danger when > 0), Reminder heartbeat ("Ran 3 hours ago" / "Stale: last run 2 days ago" with danger tone).
- [ ] Tabs: Loans (filter by status + "Overdue only"; dense table with mono IDs, tool, owner, borrower, dates, status; row → timeline), Listings (all tools; Remove opens a Dialog with a required reason 3–200 chars), Users (display name, masked email, listings, joined; Trusted lender `Switch` with optimistic update and toast), Automation (problems list with type, attempts, last error, "Replay" button → toast "Queued again"; unresolved errors with workflow, node, execution id, message, "Resolve"; heartbeat detail and reminders sent/failed in 24 h), Audit log (time, actor, action, entity, from → to, reason; filter by entity id).
- [ ] Verify; commit `feat(ui): add admin console with automation health and audit log`.

### Task 9: QA pass

- [ ] For every route: 390 px and 1280 px screenshots in light/dark (agent-browser or Playwright; store in the scratchpad, not the repo), keyboard-only walkthrough, reduced-motion check, `impeccable detect` against each running page, hallmark slop test on the landing. Fix findings or disclose them.
- [ ] Remove the `design/directions.html` mockup from the build path concerns (it stays as a reference file). Commit `chore(ui): QA fixes from responsive, keyboard and detector pass`.

## Plan 3 exit criteria

- All routes implemented, live-updating, keyboard-operable, AA in both themes, no horizontal scroll at 390 px.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
- Detector findings resolved or disclosed; DESIGN.md committed.

## Execution notes (local environment)

- Backend for visual checks: `pnpm dev:convex` (local deployment) + `pnpm dev:next`; demo data via `pnpm seed` (fictional neighbours who cannot sign in, tools, loans including an overdue one). Automation is optional for UI work (`pnpm setup:local && pnpm stack:up` if you want real emails in Mailpit).
- Authenticated screenshots: drive the user's Windows debug Chrome (port 9222, profile `C:\ChromeAgent`, already signed in to the Clerk dev instance at `http://localhost:3000`, with `role: admin`) through the `agent-browser` skill. Resize with `set viewport 390 844` / `1280 800` (or the CLI's equivalent), save screenshots under the session scratchpad, never in the repo. Toggle dark mode through the app's theme toggle.
- Do not sign out of that Chrome session and do not change Clerk settings.
