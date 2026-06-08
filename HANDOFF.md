# Sight Reading — project handoff

_Last updated: 2026-06-08_

A practice tool that turns **sight-reading on the guitar** from a wall into a
daily habit — generate a fresh line, play it, get scored note-by-note, and watch
the results add up. This document says **where the project is** and **what's left**.

---

## TL;DR — status at a glance

| Track | State | Notes |
|---|---|---|
| **Prototype app** (Electron) | ✅ Working, all tests green | Milestones 1–5 complete; Gates 1–3 cleared; **Gate 4 (human) pending** |
| **App redesign** ("Signal Tape") | ✅ Shipped | Full-bleed UI; behaviour preserved; `npm run verify` + `build` green |
| **Landing page** (Next.js) | ✅ Built, ⛔ not deployed | Email-gated download; needs Vercel deploy + real email backend |
| **Downloadable demo** (the thing the landing links to) | ⛔ **Not built** | No packaging config yet → **no GitHub Release exists** |
| **Design reference + palette** | ✅ Done | `design/` (mockups, system, palette PNG/HTML/MD) |
| **Native Swift rewrite** (the eventual goal) | ⬜ Not started | This prototype exists to de-risk it |

**The single most important open item for the market test:** there is no packaged
app to download. The landing's CTA points at `…/releases/latest`, which does not
exist. See **What's left → 1**.

---

## What this project is (and isn't)

Per the build brief (`electron-poc-pructbrief.md`), this Electron + TypeScript app
is an intentionally **throwaway prototype**. Its job is to validate three things
before a native **Swift** rewrite:

1. a **rule-based music generator** (musicality),
2. a **SQLite data schema** (stats are answerable), and
3. the core **sight-reading UX**.

**The code is disposable.** The deliverables that actually transfer to Swift are:

- the **SQLite schema** — `src/persistence/migrations/001_initial.sql`
  (byte-identical to brief §11; **do not edit**),
- the **content libraries** — `src/content/*.json` (progressions / motifs / cadences),
- **`LEARNINGS.md`** — the running design/decision log (the most valuable artifact).

Two newer tracks were added on top to **test the market** before investing in the
rewrite: a **redesign** (the "Signal Tape" visual direction) and a **landing page**.

---

## Repo map

```
src/
  domain/        pure music theory (pitch, key, chord, duration, line…)   [tsconfig.pure]
  fretboard/     position ↔ pitch mapping (string 1 = low E)              [tsconfig.pure]
  content/       progressions/motifs/cadences JSON + loaders              [tsconfig.pure]
  generator/     10-stage seeded line generator + property tests          [tsconfig.pure]
  musicxml/      MusicXML serializer (OSMD renders it)                     [tsconfig.pure]
  evaluation/    align/classify/metrics (pitch & timing accuracy)         [tsconfig.pure]
  persistence/   node:sqlite wrapper + migrations (§11 schema)            [tsconfig.node]
  cli/           generateBatch (audition batches + telemetry)             [tsconfig.node]
  audio/         Web Audio: metronome, pitch detectors (pitchy + CREPE),  [tsconfig.ui]
                 onset, RMS input level, audio graph
  ui/            React renderer — App, components/, views/, hooks          [tsconfig.ui]
electron/        main + preload (window, IPC, DB lifecycle)               [tsconfig.node]
landing/         Next.js 16 marketing site (email-gated download)         [own tsconfig]
design/          design reference: mockups, signal-tape.css, palette.*    [not shipped]
scripts/         check-purity.sh (grep guards)
LEARNINGS.md     decision log (Gate 1–3 records, CREPE rationale, …)
electron-poc-pructbrief.md   the original build brief (source of truth)
HANDOFF.md       this file
```

---

## Current state — detail

### 1. Prototype app (Electron) — ✅ working
- **Milestones 1–5 complete:** domain+fretboard → content+generator → Electron
  shell + OSMD read-along → audio input + pitch detection + evaluation + results
  → SQLite persistence + session loop + stats.
- **Tests:** `npm run verify` green — **421 unit tests** + a 1000-line generator
  property run + 3-project typecheck + the purity grep guards.
- **Pitch detection:** **CREPE (TensorFlow.js) is the default** detector
  (octave-robust); **pitchy** remains a selectable, always-available fallback.
  (Gate 3 decision — see `LEARNINGS.md`.)
- **Persistence:** Node's built-in **`node:sqlite`** (`DatabaseSync`) — replaced
  better-sqlite3 (Electron 42 V8 incompatibility). Reentrant savepoint transactions.
- **Hardware-free testing:** a "Dev tools" drawer has a **synthetic-take harness**
  (perfect / known-errors / random-accuracy) that drives the whole evaluate →
  feedback → results path without a guitar.

### 2. Redesign — "Signal Tape" — ✅ shipped
- The whole renderer was restyled to the **Signal Tape** direction
  (record-sleeve austerity + analog-studio riso). **Presentation only** — every
  hook / IPC / audio / evaluation / persistence behaviour is unchanged.
- Four screens: **Onboarding** (mic check + setup), **Practice** (OSMD on the
  "sheet" panel, transport, real RMS-driven **VU meter**, live accuracy),
  **Results** (pitch/timing metrics + inline note-by-note table + pitch-vs-time
  graph), **Progress** (accuracy trend + weak-spot heatmap).
- **Full-bleed**: the app fills the OS window (no faux window chrome).
- Fonts (**Archivo + DM Mono**) are **bundled same-origin** (CSP-safe).

### 3. Landing page (`landing/`) — ✅ built, ⛔ not deployed
- **Next.js 16** (App Router, React 19, TS), a faithful port of
  `design/landing.html`. `next build` + `eslint .` green.
- **Email-gated download:** `EmailGate` → `POST /api/subscribe` → success state
  with the download link. The route validates, never throws (400 invalid / 405
  GET), and returns `{ ok, downloadUrl }`.
- **Capture is a stub** (`lib/subscribers.ts`): forwards to
  `SUBSCRIBE_WEBHOOK_URL`, else Resend (`RESEND_*`), else logs (+ dev local file).
  **No real capture is wired yet.**
- `downloadUrl` / repo links resolve from `lib/releases.ts`
  (`NEXT_PUBLIC_RELEASES_URL` / `NEXT_PUBLIC_REPO_URL`, default to the
  `webeleon/sight-reading-guitar-practice` slug — **unconfirmed**).

### 4. Design reference (`design/`) — ✅ done
- `index.html` (hub), `app.html`, `landing.html`, `signal-tape.css` (the system),
  `palette.png` / `palette.html` / `PALETTE.md` (designer hand-off), `README.md`,
  plus the exploration trail (`brand-directions*.html`, `direction-signal-tape.html`).

---

## How to run / verify

```bash
# Prototype app (Electron)
npm install
npm run dev            # dev (electron-vite) with HMR
npm run build          # build main/preload/renderer bundles
npm run preview        # smoke-test the REAL Electron launch (do this, not browser)
npm run verify         # tests + property run + typecheck + purity guards (the gate)
npm run generate:batch -- --count 30 --out out/audition   # audition MusicXML batch

# Landing page
cd landing
npm install
npm run dev            # http://localhost:3000
npm run build          # production build
npm run lint           # eslint .
```

> **Verification lesson (saved to memory):** always smoke-test `npm run preview`
> (real Electron) — browser-serving the renderer hides main/preload bundling bugs.

---

## What's left to do

### 1. ⛔ Package the app + publish a GitHub Release  — _critical path for the market test_
The landing offers a download, but **there is no packaged binary and no release**.
There is **no packaging config** (no electron-builder / electron-forge).
- Add `electron-builder` (or Forge): macOS (arm64 + x64) `.dmg`/`.zip`, Windows
  `.exe`. Note the renderer bundles ~5 MB JS (tfjs + OSMD) + the CREPE model
  (`src/ui/public/models/crepe/*`, ~1.9 MB) — make sure the model ships in the
  package and loads from the packaged path.
- Cut a **GitHub Release**; set the landing's `NEXT_PUBLIC_RELEASES_URL` to it.
- Code-signing/notarization (macOS) is unsolved — without it users hit Gatekeeper.

### 2. Deploy the landing (Vercel) + wire real email capture
- Vercel project → **Root Directory = `landing`**.
- Env: `NEXT_PUBLIC_RELEASES_URL`, `NEXT_PUBLIC_REPO_URL`, and **one** capture
  path — `RESEND_API_KEY` + `RESEND_AUDIENCE_ID`, **or** `SUBSCRIBE_WEBHOOK_URL`.
  (Vercel's FS is read-only, so the dev local-file path won't persist in prod.)
- Confirm the real repo/release **slug** (the default is a guess).

### 3. Human gates
- **Gate 4 (you):** confirm the stats you care about are answerable from the
  schema — open **Stats**, run several first-reads, check the accuracy trend +
  weak-spot heatmap tell a useful story. This is the last brief gate.
- **Gate 3 real-hardware tuning:** the synthetic harness + CREPE cleared the
  decision, but onset/confidence thresholds (`src/audio/`) may still want tuning
  against a real guitar + interface across rooms/pickups.

### 4. Polish backlog (non-blocking)
- **Landing:** webhook/Resend fetch has no timeout; no robots.txt / sitemap;
  flux-on-bone contrast fixed for the main spots but audit any remaining flux text.
- **App:** ConfigPanel bars/tempo are ± steppers (free-form entry was dropped —
  intentional, but revisit if power users want exact BPM); results actions sit
  above the inline detail (mockup has detail as the body — minor ordering).

### 5. The native Swift rewrite (the actual goal)
When the market test validates demand, rebuild natively. **Carry over:** the §11
SQLite schema, the content-library JSON, the generator algorithm + tuning
constants, the evaluation math, and `LEARNINGS.md`. **Leave behind:** all the
Electron/React/TS code. Use a robust/neural pitch tracker (not naive
autocorrelation) per the Gate 3 finding.

---

## Key decisions & constraints (don't re-litigate without reason)

- **CREPE is the default** pitch detector; pitchy is the fallback. (`LEARNINGS.md`)
- **`node:sqlite`**, not better-sqlite3 (Electron 42 native-module incompat).
- **`001_initial.sql` is byte-identical to brief §11 — do not edit.**
- **Pure modules** (`domain/fretboard/content/generator/musicxml/evaluation`) must
  not import DOM/React/Electron and must use no `: any` — enforced by
  `tsconfig.pure.json` + `scripts/check-purity.sh` (part of `npm run verify`).
- **Seeded randomness only** in generator/content (`Math.random` is grep-banned);
  `generatedAt` is injected, never read from the clock (determinism).
- **Design = "Signal Tape"**: bone + ink; **ultramarine = structure/data**,
  **flux orange = live/feedback only**; never flux as text on bone (use
  `--flux-ink`). Type: Archivo + DM Mono, bundled (CSP). See `design/PALETTE.md`.
- **Git:** work has been committed directly to `main` per the agreed plan; commit
  messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## Known gaps / risks

- **No distributable** → the market-test download doesn't work yet (item 1).
- **Email capture is a stub** → no emails are actually stored until item 2.
- **Repo/release slug unconfirmed** → links may 404 until set.
- **macOS signing/notarization** not set up → Gatekeeper friction for testers.
- Renderer bundle is large (~5 MB) — fine for a prototype, not optimized.

---

## Commit highlights (most recent first)

```
bbf8bde  design: Signal Tape colour palette (PNG + HTML + Markdown)
b67c7bf  polish: full-bleed app window + results/landing refinements
aca1a29  feat(ui): redesign app to "Signal Tape" + real input-level VU meter
0e727ba  feat(landing): Next.js landing page with email-gated download
57bcc69  design: "Signal Tape" product design reference (HTML mockups)
df3fb0e  docs: record Gate 3 decision (CREPE over pitchy) in LEARNINGS
b1b3ef0  feat(audio): make CREPE the default pitch detector
```

See `LEARNINGS.md` for the full decision log and `electron-poc-pructbrief.md` for
the original brief.
