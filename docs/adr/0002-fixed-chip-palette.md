# ADR 0002: A fixed, hand-picked chip palette

- Status: accepted
- Date: 2026-09-18

## Context

The chip carries its state as a coloured fill: a green, amber or red pill with white
text. The obvious implementation is to derive that fill from the theme's state tokens
(`--dsw-alias-state-*`), which are exactly the semantic colours of the application and
therefore always "in palette".

That implementation was tried and rejected in practice. A tinted alias is a *blend with
whatever is behind the chip*, so the same declaration reads differently on every surface
and in every theme; and once another plugin overrides theme colours, the derived tint
became so pale that the state was no longer visible at all. The chip sits next to the
model selector, not inside a themed component, so it cannot rely on the surrounding
surface staying put.

## Decision

The three states use fixed colours, declared once in `src/client.mjs`:

| Phase | Fill | Hover | Text |
| --- | --- | --- | --- |
| `off-peak` | `#1d6b45` | `#237a50` | white |
| `soon` | `#7a5a06` | `#8f6a08` | white |
| `peak` | `#7d2626` | `#8e2c2c` | white |

The palette is intentionally desaturated: the point is a calm, always-present element,
not an alarm. Text is centred optically rather than geometrically
(`box-sizing: border-box` with `padding: 0 10px 2px`): a filled pill makes the descender
drift of centred text visible, and a 1px upward compensation removes it.

A test asserts the three declarations and asserts that no `color-mix` alias tint returns,
because this decision is about *not* following the theme.

## Alternatives

- **Derived tint (`color-mix(..., 18%, transparent)`).** Rejected: unreadable after a
  theme override, and inconsistent across surfaces.
- **A coloured dot next to muted text.** Rejected by the owner after comparison: with the
  text carrying the state as well, the pill reads faster and no longer needs a second
  element.
- **`var(--dsw-alias-label-primary)` as text colour.** Rejected: on a fixed dark fill the
  theme's primary label can be dark as well, which is unreadable in the light theme.

## Consequences

- The chip does not follow theme edits by design. If a theme needs a different palette,
  it must be changed here, and the contrast of white text on these fills (all three are
  dark enough for at least a 6:1 ratio) must be re-checked.
- The component no longer depends on any theme token for its state colour, so the only
  remaining theme tokens it uses are the panel's surface, border and label colours.
