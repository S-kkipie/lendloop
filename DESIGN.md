# Design · LendLoop

Locked design system. Future UI work reads this file first and defers to it;
pages share the system rather than differ from each other. Amend it on purpose,
in the same commit as the change. `app/globals.css` is the source of truth for
every token value; this file explains how to use them.

## System

- Genre · modern-minimal (precise, functional, B2B grade)
- Direction · B "Ledger" (`design/directions.html`, tab B): Zed-like precision,
  Linear and Stripe density. Hairlines do the structural work, not cards.
- Theme · single light theme (user decision 2026-10-31). No `.dark` tokens, no
  `dark:` classes, no theme toggle.
- Axes · light paper / grotesk sans + mono / cool accent (cobalt, hue 263)
- Warmth comes from copy and first names ("Marta R."), never from the palette.

## Tokens (values live in `app/globals.css`)

| Role | Token (Tailwind) | Value |
|---|---|---|
| Paper (page) | `bg-background` | `oklch(99.3% 0.002 260)` |
| Surface (cards, inputs, overlays) | `bg-card`, `bg-popover` | `oklch(100% 0 0)` |
| Surface 2 (table heads, footers, disabled) | `bg-muted` | `oklch(97.6% 0.004 260)` |
| Hover / highlight surface | `bg-accent` | `oklch(95.6% 0.006 262)` |
| Ink | `text-foreground` | `oklch(19% 0.012 262)` |
| Muted ink (5.6:1 on paper) | `text-muted-foreground` | `oklch(51% 0.012 262)` |
| Hairline | `border-border` | `oklch(91.5% 0.005 262)` |
| Field border | `border-input` | `oklch(85% 0.006 262)` |
| Cobalt (fill, 7.2:1 with white) | `bg-primary` / `text-primary-foreground` | `oklch(46% 0.19 263)` |
| Cobalt hover | `bg-primary-hover` | `oklch(41% 0.18 263)` |
| Cobalt soft / ink (tags, counts, links) | `bg-primary-soft` / `text-primary-ink` | `oklch(95% 0.03 263)` / `oklch(44% 0.18 263)` |
| Focus ring | `--ring` | `oklch(50% 0.19 263)` |
| Status tones | `{neutral,info,ok,warn,danger}-soft` + `-ink` | see globals.css |
| Overdue (the one loud state) | `bg-danger` / `text-danger-foreground` | `oklch(56% 0.19 25)` |

Naming: shadcn's `accent` is the neutral hover surface. The brand colour is
`primary`; its tints are `primary-soft` and `primary-ink`. Every text pair in the
table above passes WCAG AA (checked with a script against the CSS file).

## Type

- IBM Plex Sans via `next/font` (`--font-plex-sans`): 400 body, 500 UI labels,
  600 titles and display. Display tracking `tracking-display` (-0.04em); titles
  `tracking-title` (-0.01em). Headings `text-wrap: balance`, prose `pretty`.
- IBM Plex Mono (`font-mono`, 400/500): IDs, dates, counts, column heads, `kbd`.
  Never as decoration. Tabular figures are on for mono, `kbd`, `code`, `time`.
- Scale: Tailwind defaults. App UI is `text-sm` (14 px); helper text `text-xs`;
  card and dialog titles `text-base` 600; page titles `text-2xl`/`text-3xl` 600.
- No italic headings. Emphasis is weight or `text-primary-ink`.

## Shape and depth

- Radii: badge 6 px (`rounded-md`), button and field 8 px (`rounded-lg`), card,
  popover, dialog 10 px (`rounded-xl`), inner items 6 px.
- 1 px hairlines everywhere. No shadow on cards. Shadows only on overlays:
  `shadow-pop` (popover, menu, select, tooltip, toast), `shadow-dialog`
  (dialog, sheet). Never nest cards; group with hairline rows instead.
- Controls share one height per density: 36 px (`h-9`) default, 32 px `sm`.

## Components (`components/ui`, customised shadcn on Base UI)

- Button: `default` (cobalt), `outline` (hairline on surface), `secondary`,
  `ghost`, `destructive` (solid danger), `link`. Disabled is neutral surface
  with muted ink (legible), not 50% opacity. `kbd` inside buttons is styled.
- Badge: `default` (Approved), `neutral` (Requested), `info` (Handed over),
  `ok` (Returned, Available), `warn` (Back Nov 12), `outline` (Declined,
  Cancelled, Expired), `danger` (Overdue only). Text is always present.
- Tabs: `line` (default; hairline rule, 2 px cobalt bar on the active tab) and
  `segmented`. `TabsCount` renders the mono count chip ("Needs action 2").
- Table: mono 11 px column heads on surface 2, hairline rows, hover tint. Frame
  it in a `rounded-xl border bg-card` container. On mobile, render stacked rows.
- Fields: label above, helper or error below (`text-xs`, error in
  `text-danger-ink` with an icon), `aria-invalid` turns the border danger.
- Overlays: Dialog, AlertDialog (confirmations with side effects only), Sheet
  (mobile nav), Popover, DropdownMenu, Select, Tooltip (500 ms hover delay,
  instant on focus and for adjacent tooltips), Sonner toasts bottom-right.
- Command palette: `CommandDialog` has no open or close motion.
- Calendar (react-day-picker): range ends in cobalt, middle in cobalt soft.
  It reads "today", so render it client-only (after mount) and build dates as
  local calendar days, never `Date.UTC` (`lib/calendarDays.ts`). Its parts
  (Root, Chevron, DayButton) are module-level components: inline ones remount
  the grid on every parent render and drop clicks and focus.
- DateRangePicker (`components/loans`): past days fade (skipped by the
  keyboard); booked days are struck through on surface 2 and stay focusable
  with `aria-disabled` and a label ending "unavailable, booked", so keyboard
  and screen reader users learn why. Hover or focus on a booked day shows its
  range under the grid; picking across a booking or past the 30-day limit
  restarts the selection with a one-line reason in a live region.
- StatefulButton: idle, loading and success labels share one grid cell and
  swap with `motion-swap` (180 ms crossfade with a 2 px blur); it never greys
  out while busy (`aria-busy`, the caller ignores repeat clicks).
- Browse: `ToolCard` (mono No., availability badge, name, category and
  condition, lender with the Trusted seal, or "Yours"); category chips are
  toggle buttons in one row that scrolls sideways below `sm`; filters live in
  the URL (`q`, `category`, `available`); `/` focuses search.
- Ledger lists (`components/shell/LedgerList`): one framed panel of hairline
  rows. Below xl each row stacks (name and status, person, mono dates, notes,
  actions full width on phones); from xl the rows share one grid through
  `subgrid` and read as a table under mono column heads. Rows carry their own
  padding; the record's name is the link (loan timeline, tool page).
- Loan lists (`components/loans`): `StatusBadge` (label always, overdue the
  only solid tone), `LoanRow`, `LoanActions`. Secondary actions first, the next
  step last in cobalt. Confirmations (AlertDialog, focus on the safe choice)
  only for side effects: approving a request that declines overlapping ones,
  cancelling an approved booking, marking a loan returned, removing a listing.
  Everything else acts at once with a quiet toast. After an action that moves
  the row away, focus goes to the next row's first action. A disabled action
  stays focusable and says why in a tooltip. Stage tabs keep their state in
  `?tab=` and carry mono counts; the count is cobalt only where something
  waits on the viewer.
- Live rows: an item that arrives after the first paint eases in once with
  `row-arrive` (200 ms, opacity + 4 px, `useArrivals`); never on first paint
  or on a tab switch.
- Empty states (`components/shell/EmptyState`): dashed frame, small icon, why
  it is empty, and the action that fills it.
- Icons: Phosphor only (`@phosphor-icons/react`), regular weight, `fill` for
  status glyphs (seal, check), `bold` inside small badges. No emoji, no lucide.

## Shell (`components/shell`)

- Desktop (lg and up): 240 px rail on paper with a hairline; wordmark, Search
  (`⌘K` / `Ctrl K` hint), "List a tool" (`N`), nav, then the user row (Clerk
  avatar, own display name and email). Active link: ink text, surface 2 fill
  and a 2 px cobalt inset bar; `aria-current="page"`. Incoming carries a mono
  count chip of pending requests.
- Below lg: sticky top bar (menu, wordmark, search, avatar); the same rail
  content opens in a left Sheet. Key hints hide on coarse pointers.
- Pages render inside `main` (max-w-6xl, 16/24/40 px gutters); they own their
  `h1`. Wrap data views in skeletons shaped like the final layout.

## Landing (`app/(public)`)

- Static shell with two request-time holes in Suspense: the sign-in aware
  actions (Clerk `<Show>` on the server, fallback is the signed-out button) and
  the live register (`preloadQuery(tools.listPublic)` then `usePreloadedQuery`).
- Order: top bar (wordmark, two in-page anchors, Sign in `S`), left-aligned
  hero (one sentence per line from md), the Dithering band with the register
  hanging from it (first 10 rows, then a "N more" row), How it works as
  numbered ledger rows with the app's own status badges, the data promise as
  one framed panel of rows, a one-line mono footer.
- The band: Paper `Dithering` (warp, 4x4, size 1.5, speed 0.12), colours read
  from `--background` / `--band-ink` (a light cobalt, `oklch(72% 0.11 263)`) at
  runtime, so it reads as texture and the headline stays dominant. CSS fallback
  `.dither-fallback` underneath, its own pause toggle (WCAG 2.2.2), a still
  frame under reduced motion, paused off-screen. Repository links appear only when `NEXT_PUBLIC_REPO_URL` is set.

## Motion (Emil Kowalski rules)

- Easings: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`,
  `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Never `ease-in` on UI.
- Durations: row/colour 120 ms, press 140 ms, popover 160 ms (exit 120 ms),
  dialog 200 ms (exit 150 ms), sheet 240 ms (exit 180 ms). Nothing over 300 ms;
  Sonner is capped to 300 ms in globals.css.
- Primitives in globals.css: `motion-press` (scale 0.97 on `:active`),
  `motion-pop` (opacity + scale 0.97 from `--transform-origin`),
  `motion-dialog` (centred), `motion-sheet` (slides from its side),
  `motion-fade` (backdrops), `motion-none` (keyboard-first surfaces),
  `blur-fade` (first-paint entrance, CSS keyframes so it runs before
  hydration; `BlurFade` sets the 40 ms stagger index).
  They use Base UI `data-starting-style` / `data-ending-style`, so transitions
  are interruptible. Do not use tw-animate `animate-in` classes.
- No animation on keyboard-triggered actions, the command palette or tab
  switches. Hover styles only under `(hover: hover) and (pointer: fine)` (the
  `hover:` variant is redefined in globals.css).
- Reduced motion keeps opacity and drops movement; skeleton pulse stops.
- `NumberTicker` counts once on first paint (600 ms, `--ease-out`); live
  updates jump to the new value. The real number is always in the a11y tree.
- Focus ring: 2 px `--ring` outline, offset 2 px (1 px on fields, inset on menu
  items), appears instantly, never transitioned. Tailwind v4's
  `transition-colors` includes `outline-color`, so use
  `transition-[color,background-color,border-color]` on focusable elements.

## Copy

- English, plain and functional. No em dashes in UI copy. Controls name their
  action ("Request dates", "Mark returned"). Errors say what happened and what to
  do next. Silent success for visible effects; quiet toasts otherwise.
- People are display names ("Marta R."). Never render another person's email;
  only the viewer's own (user menu) and the admin's masked emails.

## Anti-patterns (refuse)

Nested cards, coloured side-stripe borders, gradient text, glassmorphism and
decorative backdrop blur, icon-tile feature grids, eyebrow labels above
headings, `transition-all`, uniform hover-scale, bounce easings, colour-only
status, 50% opacity disabled text, default shadcn look (ring-3 halos, rounded
pills), mono used as costume, more than one accent colour.

## Exports

Tailwind v4 `@theme` (static for fonts, radii, easings; inline for colours and
shadows) and shadcn CSS variables both live in `app/globals.css`. Clerk reads
the same variables through `appearance.variables` in `app/layout.tsx`
(`cssLayerName: "clerk"`, layered before components and utilities).
