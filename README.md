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
src/host.mjs                 Host half of the installable package (empty: this plugin is browser-only)
lib/index.js                 built Host half, the file a profile row imports
lib/client.js                built browser bundle, served as a classic script
tools/inline-sources.mjs     turns the two sources into text an import-less scope can hold
tools/dynamic-body.mjs       builds the body of the dynamic Cordis Package (development loop)
tools/build-package.mjs      builds lib/, the installable package
test/peaks-core.test.js      boundary table for the rule and the panel text
test/dynamic-body.test.js    evaluates the generated body with stub builtins: slots, gating, surfaces
test/package-bundle.test.js  loads lib/client.js the way the page does and mounts it
test/support/stubs.mjs       fixtures shared by both artifact suites
docs/adr/                    decision records
```

`src/peaks-core.mjs` holds every date computation and no UI; `src/client.mjs` holds every
UI decision and no date computation. The split exists so the interesting half can be
tested without a browser.

Two artifacts come out of that one source tree, and both are built from the same inlined
text so they cannot drift apart:

- the **dynamic Cordis Package body** — `tmp/dynamic-client-body.js`, transcribed by hand
  into `cordis_define` for the development loop, with comments dropped to stay small;
- the **installable package** — `lib/`, with a Host half for the profile row and a browser
  bundle that registers itself with the page's module loader.

## Working on it

```sh
npm test                    # both artifacts plus the rule table
npm run build               # rewrites lib/ — commit it with the source change
npm run build:dynamic       # rewrites tmp/dynamic-client-body.js
```

`test/package-bundle.test.js` fails if `lib/` is stale, so a forgotten `npm run build`
cannot ship a bundle that disagrees with its sources.

`createPlugin(deps)` takes `{ styles, report }`: `styles.insert(css)` must return a
disposer, and `report` is an optional diagnostic sink (a payload per state transition)
that is only wired up during development — the shipped artifacts call
`createPlugin({ styles })`. The dynamic runner supplies `styles` as a builtin; the browser
bundle supplies a `<style>` element it owns and tags with `data-plugin`, which is how the
module loader attributes and disposes injected CSS.

## Installing it

The package is a browser-only Cordis plugin, so it needs both halves of the client
contract, and a profile needs two things:

1. **The package itself, resolvable from the profile.** `lib/client.js` is read from
   `exports["./client"]` of the resolved package, and a missing bundle is a startup error.
2. **A Host row mounting it**, because the browser roster is composed by scanning the Host
   Loader's rows for packages declaring `dsh.client`:

   ```yaml
   - insert:
       - id: deepseek-peaks
         name: deepseek-peaks
   ```

   The row's module specifier is authoritative, so the package may be resolved by name or
   addressed by path.

`dsh.client` declares `platform: "web"` and nothing else: no package dependencies, and no
`external` modules, because the bundle's only module request is `react`, which the client
baseline seeds. `npm run build` must have run before the profile starts — `lib/` is
committed, so an install that copies the package directory needs no build step.

## Status

The indicator runs today as a dynamic Cordis Plugin inside this session, and the
installable package is built and covered by tests. Wiring it into this machine's profile —
including the Nix configuration that provides the package and the row above — is a
separate, deliberate step.
