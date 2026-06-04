# LEARNINGS

The running log of non-obvious discoveries for the sight-reading prototype. This file
is the single most important deliverable — it carries into the future native Swift
rewrite. The code is throwaway; the learnings, the data schema, and the content JSON are
not.

Each milestone appends a section. Record what surprised you, tuning discoveries, schema
adjustments, and anything the Swift implementation should know.

---

## Scaffold (Milestone 0)

### Environment

- Node: v24.13.0
- npm: 11.6.2
- git: 2.50.1 (Apple Git-155)
- Platform: macOS (darwin 25.3.0), arm64

### Pinned tooling versions (latest stable at scaffold time, 2026-06)

- TypeScript 6.0.x
- Vite 8.0.x, electron-vite 5.0.x, @vitejs/plugin-react 6.0.x
- Vitest 4.1.x + @vitest/coverage-v8 4.1.x
- tsx 4.22.x, happy-dom 20.10.x
- seedrandom 3.0.5 (+ @types/seedrandom 3.0.8), opensheetmusicdisplay 1.9.x

### Key tooling decisions

- **The no-DOM-lib purity trick.** `tsconfig.pure.json` sets `lib: ["ES2022"]` ONLY —
  no `DOM`. The pure modules (`domain`, `fretboard`, `content`, `generator`, `musicxml`,
  `evaluation`) compile under it, so ANY reference to `document`/`window`/`navigator` or
  to DOM types is a hard compile error rather than a convention you have to remember.
  This is the primary enforcement of "pure modules stay pure." It does NOT catch React
  imports of values, `Math.random()`, or `: any` — `scripts/check-purity.sh` is the
  backstop for those.

- **Layered tsconfig with project references.** Four configs:
  - `tsconfig.base.json` — strict, ESNext modules, Bundler resolution, ES2022 target,
    `verbatimModuleSyntax`, `resolveJsonModule`, `esModuleInterop`, `skipLibCheck`,
    `noEmit`. Deliberately did NOT enable `noUncheckedIndexedAccess` or
    `exactOptionalPropertyTypes` — kept off for iteration speed on a throwaway.
  - `tsconfig.pure.json` — `lib: ["ES2022"]` (no DOM), pure dirs only. The purity wall.
  - `tsconfig.node.json` — `types: ["node"]`, `lib: ["ES2022"]`, for `cli` + `persistence`.
  - `tsconfig.ui.json` — `lib: ["ES2022","DOM","DOM.Iterable","WebWorker"]`, for `ui` + `audio`.
  - root `tsconfig.json` — `files: []` + `references` to the three. Used for editor
    layering / `tsc -b`; actual test runs go through vitest, not tsc.

- **vitest 4 uses `test.projects` (array), not the old `workspace` file.** Configured two
  projects in one `vitest.config.ts`: a default `node` project (`src/**/*.test.ts`,
  excluding `*.dom.test.ts`) and a `happy-dom` project matching `src/**/*.dom.test.ts`
  (for OSMD / musicxml render tests). `extends: true` on each project inherits the root
  `coverage` (v8) and `testTimeout: 120_000` (needed for the M2 1,000-line property test).
  The node project EXCLUDES `*.dom.test.ts` so those files run exactly once, under DOM.

- **`scripts/check-purity.sh` must run under macOS stock bash 3.2.** `#!/usr/bin/env bash`
  on this machine resolved to `/bin/bash` = GNU bash 3.2.57 (Homebrew bash 5 exists at
  `/opt/homebrew/bin/bash` but is later in PATH for non-interactive shells). bash 3.2 has
  NO `mapfile`/`readarray` and no associative arrays — the first draft used `mapfile` and
  silently would have broken. Rewrote using space-separated strings + word-splitting.
  Verified the script both passes on clean dirs and fails (exit 1) on planted violations
  of all four classes (electron/react import, DOM global, `Math.random()`, `: any`).

### Why certain deps are deferred to later milestones

Per the task, this run does NOT install: `react`, `react-dom`, `better-sqlite3`,
`pitchy`, or `electron`.
- `react` / `react-dom` / `electron` — only needed for the Electron shell + UI (M3+).
  Keeping them out now also means an accidental React import in a pure module fails to
  resolve at all, reinforcing purity during M1/M2.
- `better-sqlite3` — persistence (M5); it's a native module (node-gyp build) and there's
  no reason to pay that install cost or risk a toolchain hiccup before it's used.
- `pitchy` — audio pitch detection (M4).

### Dependency version surprise (flagged)

There is a **vite major-version peer conflict** in the dependency graph:
- `electron-vite@5` peers want `vite ^5 || ^6 || ^7`.
- `vitest@4.1` and `@vitejs/plugin-react@6` peer-require `vite ^8`.

We pinned `vite ^8` (what vitest 4 needs now; tests run this run, electron-vite does not
until M3). npm install surfaces this as a peer-dependency warning, not an error, and the
install succeeds. Watch this at M3 when wiring electron-vite: if electron-vite 5 misbehaves
on vite 8, either bump to an electron-vite release that supports vite 8 or pin vite to 7
and accept that vitest may warn. Documented here so M3 doesn't rediscover it cold.
