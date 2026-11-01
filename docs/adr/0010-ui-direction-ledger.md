# ADR 0010: UI direction "B · Ledger"

- Status: accepted, 2026-10-31
- Covers: D13 in the [design spec](../superpowers/specs/2026-10-31-lendloop-design.md#2-decision-summary)

## Context

The reviewers build B2B tools for clinicians: dense, calm, keyboard-friendly interfaces where trust matters more than decoration. Three directions were mocked side by side in `design/directions.html`.

## Decision

Direction B, "Ledger": IBM Plex Sans and IBM Plex Mono, one cobalt accent, 1 px hairlines instead of cards, Linear and Stripe density, keyboard hints (`⌘K` palette, `N` for a new listing), and a Paper Shaders `Dithering` band on the landing page that is static under reduced motion. Single light theme. Tokens and rules are locked in [DESIGN.md](../../DESIGN.md).

## Consequences

- Status is always text plus colour, never colour alone; every text pair passes WCAG AA on the light surfaces.
- Mono type for IDs, dates and counts makes the audit-heavy screens (timeline, admin) scannable.
- No dark mode (user decision), which keeps one palette to verify.
- Motion stays under 300 ms and is skipped for high-frequency actions.
