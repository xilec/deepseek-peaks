# ADR 0001: Show the DeepSeek peak-pricing state inside the session UI

- Status: accepted
- Date: 2026-09-18

## Context

DeepSeek bills the same model at two rates depending on the wall clock: peak rates inside
two fixed UTC windows on weekdays, and half price outside them
(`RULE.sourceUrl`, verified `RULE.verifiedOn`). The person driving a DSH session decides
whether to send an expensive request now or in ten minutes, and that decision needs the
state and the countdown to the next change — not a link to the pricing page.

The rule is a property of the *billing provider*, not of the session, the workspace or
the model name: the same model reached through a reseller is billed by the reseller.

## Decision

1. The state is displayed unconditionally, without a setting, whenever the session's
   route is billed by `deepseek-official`.
2. It is displayed as a chip: a small, muted pill with the phase colour and a live
   countdown. Clicking it opens a panel with the windows in the reader's zone, the UTC
   statement of the rule, the source and the next change.
3. The chip is mounted in the session header, and — for a fresh session, whose header
   does not exist — floating over the composer card, at the right edge, on the same line
   as the mode selector. The floating chip must not add a row to the composer stack.
4. The phase comes from the browser clock. The rule is stated in UTC and the reader's
   zone is used only to display windows; there is no server time source, no persistence
   and no background poll — a single one-second interval runs only while a chip is
   mounted.
5. The route is resolved from the session's recorded model selection, falling back to the
   catalog default only when a recorded selection exists but is empty. An absent
   projection hides the indicator rather than guessing.

## Alternatives

- **A settings toggle.** The state is a property of the clock and the billing route, not
  a preference; a toggle would mostly produce "why is my request expensive" surprises.
- **A line in the composer's own row.** It changed the composer layout: the hero block
  moved upwards whenever a session was blank. Rejected in favour of the zero-height
  overlay anchor.
- **A blocking banner or modal.** Peak pricing is a normal, recurring state; the
  indicator must stay ignorable.
- **Time from the Host.** The Host clock and the browser clock can disagree by seconds;
  the countdown is a display of *the reader's* time and the phase windows are hours long,
  so the browser clock is sufficient and keeps the client half self-contained.

## Consequences

- The chip is always present for DeepSeek sessions, so its visual weight is a real
  constraint: it must be ignorable in the common off-peak case. That motivated the muted
  fixed palette of ADR 0002.
- A route that cannot be resolved hides the indicator. This is deliberate: a wrong
  indicator would be worse than a missing one, and the route resolution is covered by
  tests.
- Because the rule is frozen in `src/peaks-core.mjs` with a verification date, a pricing
  change by DeepSeek is a one-file edit plus one test update.
