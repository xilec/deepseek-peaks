# Context: DeepSeek peak pricing in a DSH session

This file is the shared language for the project. Code, tests and ADRs use these words
with exactly these meanings; a new term belongs here before it belongs in code.

## The rule

**Rule** — the frozen description of when DeepSeek bills peak rates. It is encoded once,
in `src/peaks-core.mjs`, as `RULE`: two windows in UTC minutes, the weekdays it applies
to, the off-peak rate ratio, the warning lead time, the source URL and the date the
source was checked. Nothing else in the project may hardcode a window.

**Peak window** — a UTC interval inside the rule: 01:00–04:00 and 06:00–10:00 UTC, on
Monday–Friday. Weekends have no peak window at all.

**Off-peak** — every instant outside a peak window. Off-peak rates are half of peak
rates (`offPeakRateRatio`), which is the whole reason the indicator exists.

**Phase** — the state of one instant, derived from the clock alone: `off-peak`, `soon`
or `peak`. `soon` means "a peak window starts within `warnLeadMs`", i.e. the last 30
minutes before either window; it is a warning, not a rate.

## The session

**Route** — the `{ provider, model }` pair the next request would use. The rule is a
DeepSeek billing rule, so the indicator is meaningful only for the **billing provider**
`deepseek-official`; the same model name reached through a reseller is billed by that
reseller and must stay silent.

**Recorded selection** — the model selection stored in the session (`next`, falling back
to `lastUsed`). It wins over everything else, because it is what the session will
actually send.

**Catalog default** — the selection the model picker would fall back to. It is consulted
only when a recorded selection exists but is empty (`{ lastUsed: null, next: null }`),
mirroring the picker's own rule. An **absent** projection (`undefined`/`null`) means "the
session has not chosen yet" and hides the indicator: the project never guesses a route.

**Fresh session** — `blank && !running && !promptAttempted`, the same predicate the
composer uses to decide whether to show its hero. A fresh session has no session header,
so it needs its own surface.

## The indicator

**Chip** — the indicator itself: a compact, muted pill carrying the phase colour and a
countdown (`Off-peak · peak in 13h 30m`). Clicking it toggles the **panel**.

**Panel** — the popover opened from the chip: what the current state costs, the peak
windows in the reader's own zone for today and tomorrow, the UTC statement of the rule,
the source and the next change.

**Surface** — where the chip is mounted. There are exactly two, and exactly one of them
renders at a time: the **header surface** (`conversation.session.header.actions`) for a
session that is not fresh, and the **composer surface**
(`conversation.input.overlay`, a zero-height absolutely positioned anchor inside the
composer card) for a fresh session, where the header does not exist. The composer surface
must not add a row to the composer stack: doing so pushes the hero block upwards.

**Countdown** — the remaining time to the next change. Seconds appear only in the last
hour; beyond a day the text switches to days and hours.

## Time

**Now** — the browser clock. The rule is stated in UTC, so the phase is computed from
UTC parts; the reader's zone is used only to *display* the windows. There is no server
time source and no persisted state: reloading the page re-derives everything.

**Zone** — the browser's IANA zone, resolved once per page load. Display falls back to
UTC (and UTC-only window labels) when `Intl` is unavailable.

## Vocabulary to avoid

- "peak hours" as a synonym for `soon` — `soon` is the warning phase, not a rate.
- "provider" alone when the gate is meant — say **billing provider**.
- "tint"/"theme colour" for the chip palette: the palette is fixed (see ADR 0002), it is
  not derived from theme tokens.
