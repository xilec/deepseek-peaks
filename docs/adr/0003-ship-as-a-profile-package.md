# ADR 0003: Ship the indicator as a profile package, not only as a dynamic Package

- Status: accepted
- Date: 2026-09-18

## Context

The indicator was developed as a dynamic Cordis Package: a Package defined inside one
session, evaluated as a plain function body, receiving `React`, `styles` and `host` as
runner builtins. That form is excellent for the development loop — define, run, look,
correct — but it exists only in the running process. It disappears on restart, it is tied
to one session, and it cannot be enabled on a machine as part of a profile.

Making it a normal package is not just "move the file". The two forms differ in ways that
had to be answered:

- A dynamic body cannot `import`, so the sources are inlined. A real package can have a
  build step, but then two artifacts exist and can drift.
- The dynamic runner supplies `styles`; a browser bundle has to own its stylesheet.
- A browser bundle is delivered by the client module system, which composes its roster by
  scanning the *Host* Loader's rows for packages declaring `dsh.client`. A browser-only
  plugin therefore still needs a Host row — one that does nothing.

## Decision

1. The repository is an installable package: `main` is the Host half, `exports["./client"]`
   is the browser bundle, and `package.json` declares `dsh.client.platform: "web"`.
2. The Host half is an empty `apply`. It exists so the roster scan can reach the package.
3. The browser half is a self-contained classic script that registers a factory under the
   package name and returns a Cordis plugin (`apply`, `inject: ["timer", "slots"]`). Its
   only module request is `react`, which the client baseline seeds, so it declares no
   `dsh.client.external`.
4. The bundle owns its stylesheet: one `<style>` element, tagged with `data-plugin` and
   `data-plugin-css`, removed when the plugin's fiber disposes.
5. Both artifacts are built from one inlined text (`tools/inline-sources.mjs`), and `lib/`
   is committed. `test/package-bundle.test.js` fails when `lib/` no longer matches the
   sources, so the committed build cannot silently drift.

## Alternatives

- **Keep only the dynamic form.** Rejected: it cannot be installed on a machine, and the
  indicator is meant to be always there.
- **Bundle with the repository's own bundler (tsdown/rolldown).** Rejected as unnecessary:
  the client reads exactly one file, the code has no dependencies beyond a baseline
  module, and a hand-written wrapper keeps the build a single readable Node script with no
  toolchain to install. The tradeoff is one bundle-style wrapper maintained in
  `tools/build-package.mjs`.
- **Do not commit `lib/`.** Rejected: a profile install then needs a build step before the
  first start, and a missing bundle is a startup error. The drift test makes committing it
  safe.

## Consequences

- Two artifacts share one source of truth; the tests exercise both, so a change that only
  reaches one of them fails the suite.
- The package remains `private` and is installed from this directory; nothing here is
  prepared for publishing to a registry.
- The wrapper is the only place that knows about the module loader. If the client contract
  changes (registration shape, baseline modules), it is the file to revisit.

## Update (2026-09-18): delivery through Nix

The package is now provided by `flake.nix`, which copies `package.json` and `lib/` into one
store directory, and a home-manager module inserts the row with
`name = "${pkg}/lib/index.js"`. A path-like row is resolved through `realpath`, and the
manifest is looked up by walking up from the module, so the row must point into a directory
that really contains `package.json`.

This makes `home.file` unsuitable: it links each file to its own `hm_<name>` derivation in
the store root, so the manifest is not near the module and the scan finds nothing — a
silent failure where the host row loads happily and the browser never receives a bundle.
A directory built by `runCommand` has no such problem, and `nix flake check` runs the test
suite against the flake source, so a stale `lib/` fails the Nix gate as well.
