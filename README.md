# deepseek-peaks

A small indicator for a DSH session: is DeepSeek billing peak rates right now, and how
long until that changes? It shows a live countdown next to the model selector and, on
click, explains the peak windows in your own timezone.

The rule is taken from <https://api-docs.deepseek.com/quick_start/pricing> and frozen in
`src/peaks-core.mjs` together with the date it was verified. See `CONTEXT.md` for the
project's vocabulary and `docs/adr/` for the decisions.

## What it shows

| Phase | Chip | Meaning |
| --- | --- | --- |
| `off-peak` | green pill, `Off-peak · peak in 2h 15m` | outside every peak window; rates are halved |
| `soon` | amber pill, `Peak soon · 12m 30s` | a peak window starts within 30 minutes |
| `peak` | red pill, `Peak · ends in 3h 6m` | inside a peak window; rates are doubled |

Seconds appear only in the last hour of a countdown, and anything longer than a day is
shown as `2d 15h`. The chip is deliberately quiet: a desaturated fill, no animation, no
tooltip, not even a dot. The panel behind it lists the current state, the windows for
today and tomorrow in the browser's zone, the UTC statement of the rule, the next change
and the source link.

The indicator only appears when the session's route is billed by `deepseek-official`. A
DeepSeek model reached through a reseller is billed by that reseller and stays silent — as
does a session whose model choice cannot be resolved, because a wrong indicator would be
worse than a missing one.

## Where it is drawn

There are exactly two surfaces, and exactly one of them renders at a time:

- `conversation.session.header.actions` — the session header, for any session that
  already has content. The panel opens downwards.
- `conversation.input.overlay` — the resident composer card's overlay anchor, for a fresh
  session (`blank && !running && !promptAttempted`), whose header does not exist. The
  anchor is absolutely positioned and zero-height, so the chip floats at the right edge on
  the same line as the mode selector without adding a row to the composer stack — adding
  one would push the composer hero upwards. The panel opens upwards.

## Repository layout

```
src/peaks-core.mjs           the rule, phases, route resolution and panel model — no DOM, no React
src/client.mjs               the Cordis plugin: slots, components, timer, CSS
src/index.mjs                Host half of a packaged install (empty: this plugin is browser-only)
tools/dynamic-body.mjs       inlines core + client into one dynamic Cordis Package body
test/peaks-core.test.js      boundary table for the rule and the panel text
test/dynamic-body.test.js    evaluates the generated body with stub builtins: slots, gating, surfaces
docs/adr/                    decision records
```

`src/peaks-core.mjs` holds every date computation and no UI; `src/client.mjs` holds every
UI decision and no date computation. The split exists so the interesting half can be
tested without a browser.

## Working on it

```sh
npm test                              # runs both suites with node --test
node tools/dynamic-body.mjs           # writes tmp/dynamic-client-body.js
```

`tools/dynamic-body.mjs` strips the `import`/`export` syntax and comment-only lines from
the two sources and appends the `createPlugin(...)` call, producing the exact body that is
handed to a dynamic Cordis Package. `test/dynamic-body.test.js` evaluates that same text,
so the tests exercise what actually ships rather than a paraphrase of it.

`createPlugin(deps)` takes `{ styles, report }`: `styles.insert(css)` must return a
disposer, and `report` is an optional diagnostic sink (a payload per state transition)
that is only wired up during development — the shipped package calls `createPlugin({ styles })`.

## Status

The indicator runs today as a dynamic Cordis Plugin inside this session. Turning it into
an installable profile package (`~/.dsh/profiles/...` plus a `cordis.patch.yml` row) is a
separate step: the dynamic runner supplies a `styles` builtin, while a bundled browser
plugin has to own its stylesheet and be wrapped by the client bundler's module loader.
