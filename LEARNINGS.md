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

---

## Domain (Milestone 1 — Part A)

`/src/domain` is built and green: 111 vitest tests across 8 files, `tsc -p
tsconfig.pure.json` clean, `verify:purity` clean. No `any` anywhere. Modules
(dependency order): pitch -> key (pitch's `midiToPitch` consults key, key uses
pitch's `pitchClass` — a tight but acyclic-at-runtime mutual reference, see below)
-> duration -> timeSignature -> neckPosition -> interval -> chord -> line -> index.

### Enharmonic spelling approach (the central design)

Spelling (NoteName + Accidental) is first-class everywhere; MIDI is the lossy
projection, never the source of truth. Two cooperating ideas make all 30 keys come
out right:

1. **Key signatures via the circle of fifths.** Each MAJOR tonic spelling maps to a
   signed fifths count (-7 Cb .. +7 C#) in `MAJOR_FIFTHS`. A MINOR key reuses its
   relative major's count (relative major = minor tonic up a minor third = 2 letters
   up, accidental chosen to land on minorPc+3). `keySignature` returns
   `{sharps:n}` or `{flats:n}` from the sign.

2. **Scale built by letter, accidentals applied from the signature.** `diatonicScale`
   walks 7 consecutive letters starting at the tonic letter, and applies the
   signature's accidentals in the canonical order (sharps F C G D A E B; flats
   B E A D G C F). Because each letter is used exactly once and the accidental comes
   straight from the signature, the hard cases fall out for free:
   - F# major (6 sharps F C G D A E) -> F# G# A# B C# D# E#  (E# present, B natural)
   - C# major (7 sharps) -> C# D# E# F# G# A# B#  (E# and B#)
   - Gb major (6 flats B E A D G C) -> Gb Ab Bb Cb Db Eb F  (Cb present)
   - Cb major (7 flats) -> Cb Db Eb Fb Gb Ab Bb  (Fb and Cb)
   There is a test asserting every one of the 30 keys uses all 7 letters exactly once.

3. **midiToPitch is key-aware** by preferring the diatonic spelling: if the sounding
   pitch class matches a scale degree, spell it exactly as that degree (this is what
   makes a flat key spell MIDI 58 as Bb3, and what would spell F# major's MIDI 65 as
   E#). Non-diatonic (chromatic) pitch classes fall back to a sharp- or flat-oriented
   default table chosen by whether the key signature has flats. Round-trip
   `pitchToMidi(midiToPitch(m,key)) === m` is tested across MIDI 40-88 in 7 keys.

### Tricky cases / non-obvious decisions

- **Octave assignment for accidentals that cross C.** Cb5 SOUNDS as MIDI 59 (= B4),
  so when you spell a letter+accidental you must back-solve the octave from the
  target MIDI, not from the natural-letter octave. `octaveForSpelling` (pitch.ts) and
  the octaveBump logic in `chord.spellTone` / `key.diatonicScale` all do this. Naive
  octave = floor(midi/12)-1 gives Cb the wrong octave.

- **midiToPitch <-> key mutual reference.** pitch.ts imports `diatonicScale` and
  `keySignature` from key.ts (for spelling), and key.ts imports `pitchClass` from
  pitch.ts. This is a static import cycle but safe at runtime: nothing runs at module
  top level except const tables; the functions only call across the boundary when
  invoked. ESM handles this fine. If the Swift port splits these into separate files,
  keep them in the same module/target to avoid a build-order headache.

- **Interval = letter-distance for SIZE, semitone-delta for QUALITY.** `intervalBetween`
  computes size from the diatonic letter span (so C->E is always a 3rd) and quality by
  comparing actual semitones to the perfect/major reference for that size. This is what
  distinguishes C->F# (augmented 4th, 6 semitones) from C->Gb (diminished 5th, also 6
  semitones). An exact octave is reported as size 8 / 12 semitones (special-cased so
  letterSpan%7==0 with span>0 reads as octave, not unison).

- **Minor-key Roman numerals: VII vs vii is a ROOT difference, not just quality.**
  The natural-minor 7th degree is the SUBTONIC (Bb in C minor); `VII` major =
  Bb-D-F. The LEADING-TONE chord `vii` (lowercase + a diminished-family quality) has
  its root raised a chromatic semitone to the leading tone (B natural) -> B-D-F or
  B-D-F-Ab. `romanNumeralToChord` only raises the root for degree 7, lowercase, with a
  diminished/halfDiminished/fullyDiminished quality. Everything else (incl. V major /
  V7 in minor) keeps the natural scale-degree root and gets its raised leading tone
  through the chord's THIRD via the quality's interval recipe — no root surgery needed.
  The Roman-numeral string's trailing markers (7, o, +, ø) are ignored; the explicit
  `quality` argument is authoritative. Case is only consulted to disambiguate vii/VII.

- **Chord tones are stacked by (letterStep, semitones) recipes**, not by interval
  names, so spelling is automatic: e.g. fullyDiminished's 7th is letterStep 6 /
  9 semitones -> a spelled diminished seventh (B->Ab), and augmented's 5th is
  letterStep 4 / 8 semitones -> G# from C. `spellTone` back-solves the accidental
  from the desired sounding MIDI and the fixed target letter.

### JSON round-trip safety

All domain types are plain data (no classes, no functions, no Map/Set in the shapes
that persist). `makeDuration` and `makeNeckPosition` OMIT optional keys (`tuplet`,
`label`) entirely when absent rather than setting `undefined`, so `JSON.parse(
JSON.stringify(x))` deep-equals `x`. Tested for Duration, NeckPosition, Chord, and a
full Line (including a rest, where `pitch: null` survives). This matters for the
SQLite `line_json` column and the eventual Swift `Codable` transfer.

### Co-located generator-shape interfaces (avoiding an import cycle)

`Line` references `ConcreteProgression`, `PhraseStructure`, `ContourTarget`, and
`RhythmicMotifPlan`. These are produced by `/generator` but their SHAPES are declared
in `line.ts` (in `/domain`) on purpose: declaring them in `/generator` would force
`/domain` to import `/generator` (a cycle, and a purity violation). `/generator` will
import these from `/domain` instead. Concrete shapes chosen: PhrasePattern =
AAAB|ABAB|ABAC|throughComposed with a `barRoles: string[]`; ContourShape =
arch|invertedArch|ascending|descending|steady with climaxBar/climaxPitch/perBarTargets;
RhythmicMotifPlan = perBarMotifIds + variations[{barIndex, kind}].

### Purity-script gotcha (cost me one red run)

`scripts/check-purity.sh` greps for the bare words `document|window|navigator` with
`-w` across the pure dirs — it does NOT skip comments. The word "window" in a
docstring/test description (a fretboard "window") tripped it. Avoid those three words
entirely in pure modules, even in prose; I reworded to "region". The no-DOM-lib
tsconfig would NOT have caught this (it's a string in a comment), so the grep is doing
real work here.

---

## Fretboard (Milestone 1, part B)

### Module shape

Three files + barrel under `src/fretboard`:
- `tuning.ts` — `OPEN_STRING_MIDI = [40,45,50,55,59,64]` (string 1 = low E first),
  `STRING_NUMBERS`, `openStringMidi(stringNumber)`.
- `fretboardModel.ts` — `MAX_FRET = 17`, `midiAt(string,fret)`, `pitchClassAt(...)`,
  `buildFretboardModel(): FretboardCell[]` (flat 6 x 18 list).
- `positionMapping.ts` — `computePlayablePitches(position, stringSubset?)` and
  `isPlayableInPosition(pitch, position, stringSubset?)`.

### Deliberate decision: the fretboard is SPELLING-AGNOSTIC

The brief's signature shows `computePlayablePitches` returning `{ pitch: Pitch; ... }`,
but section 7 also says "return pitch-class info sufficient for the caller to spell."
Those conflict: a single fret has a DIFFERENT correct spelling per key (MIDI 63 is D#
in E major but Eb in Bb major), so a `Pitch` returned here would have to guess. I
returned `{ midi, pitchClass, stringFretOptions }` (`PlayablePitch`) with NO name/
accidental, and the caller spells via `midiToPitch(midi, key)` from domain. The
positionMapping test demonstrates the round-trip: `prettyPitch(midiToPitch(60, Cmajor))
=== 'C4'`. The Swift rewrite should keep this split — fretboard returns sounding pitch,
key context spells.

### 5th-position arithmetic (the acceptance criterion), verified

Position V = frets 4-8 inclusive, all 6 strings. Per-string MIDI ranges:
string 1 (40)->44..48, string 2 (45)->49..53, string 3 (50)->54..58,
string 4 (55)->59..63, string 5 (59)->63..67, string 6 (64)->68..72.
Union is **exactly contiguous MIDI 44..72 = 29 distinct pitches, no gaps**. The only
duplicate-fingering pitch is **MIDI 63 (D#4/Eb4): string 4 fret 8 AND string 5 fret 4**
— the standard guitar unison across the G/B string pair. The test asserts this exact
overlap so a future tuning/range change that breaks it fails loudly.

### isPlayableInPosition agrees by construction, tested by full sweep

`isPlayableInPosition` and `computePlayablePitches` share the same allowed-strings x
fret-range enumeration, so they cannot disagree. The test still proves it the brutal
way: sweep MIDI 30..90 and assert `isPlayableInPosition(midi)` matches
`computePlayablePitches().has(midi)` for every value. It also takes EITHER a spelled
`Pitch` or a raw `number`, comparing by sounding MIDI — so enharmonic spellings (D#4 vs
Eb4) both resolve to MIDI 63 and both return true.

### stringSubset honors the INVERTED numbering

`stringSubset` filters by the same 1=low-E..6=high-E numbers. Restricting Position V to
strings [5,6] yields MIDI 63..72 (10 pitches). Watch the inversion: "high strings" in
this codebase means the HIGHER string NUMBERS (5,6), which are the physically
high-pitched B/high-E. Easy to invert by reflex.

### Purity / prose hazard avoided

Per the existing purity-script note, I used "region" not "window" in all fretboard
prose and identifiers. `npx tsc -p tsconfig.pure.json --noEmit` and `verify:purity`
both pass. 21 fretboard tests green; full suite 132 green.
