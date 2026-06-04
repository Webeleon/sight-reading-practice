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

---

## Content — cadenceLibrary (Milestone 2)

`src/content/cadenceLibrary.ts` + `src/content/data/cadences.json`, TDD via
`cadenceLibrary.test.ts` (17 tests green). 4 placeholder cadences: authentic
(V->I, leadingTone->tonic, stepUp), authentic-via-supertonic (V->I,
supertonic->tonic, stepDown), half (I->V), plagal (IV->I).

### JSON loading pattern for pure modules

Used a STATIC import attribute: `import doc from './data/cadences.json' with
{ type: 'json' }`. `resolveJsonModule` is on in tsconfig.base, and tsx/vitest both
honor the `with { type: 'json' }` attribute. This keeps the loader pure (no `fs`, no
DOM, no path resolution at runtime) and bundles the content. The JSON file is NOT
scanned by check-purity.sh (it only globs `*.ts`/`*.tsx`), so JSON content is free of
the prose hazards.

### `_meta` wrapper object, not a bare array

cadences.json is `{ "_meta": {...PLACEHOLDER...}, "cadences": [...] }`, NOT a bare
array. `loadCadences()` validates ONLY `doc.cadences`, so the `_meta` placeholder
marker never has to satisfy the entry schema. (The sibling motifs.json/progressions.json
from other M2 agents use the same wrapper-key shape: `{ motifs: [...] }`,
`{ progressions: [...] }`. Keep this consistent in the Swift port — top-level object
with a named array key + `_meta`, so metadata and content coexist without a union type.)

### Validator design: split `validateCadences(unknown)` from `loadCadences()`

`validateCadences(raw: unknown)` validates an ARBITRARY value and throws on any
structural/enum/duplicate-id violation; `loadCadences()` just feeds it the bundled
JSON. This split is what makes the "broken content throws" tests possible WITHOUT a
broken fixture file on disk — the test passes hand-built malformed objects directly.
Recommend this two-function shape for every content loader.

### Cadence enums live in /content, not /domain

There are no cadence types in `src/domain/line.ts`. The melodicResolution enums
(`from`: tonic|supertonic|leadingTone|mediant|submediant|dominant|subdominant;
`to`: tonic|mediant|dominant; `motion`: stepUp|stepDown|leap) and difficulty 1..5 are
defined and validated locally in cadenceLibrary.ts. The harmonicMovement from/to are
free-form Roman-numeral strings validated only for parseability (regex `^[ivxIVX]+`,
mirroring domain/chord.ts's permissive front-of-string parse) — they are instantiated
into concrete chords later by the generator via `romanNumeralToChord`.

### KNOWN ISSUE for the M2 lead: `console` breaks tsconfig.pure.json

`tsconfig.pure.json` has `lib: ["ES2022"]` and NO `types`, so `console` is undefined ->
`tsc -p tsconfig.pure.json` errors `TS2584: Cannot find name 'console'` on EVERY content
loader that does structured logging (cadenceLibrary, motifLibrary, progressionLibrary all
hit it). The brief (section 16) MANDATES `console.log` with `[CONTENT]`/`[GEN]` prefixes,
so the fix is NOT to drop logging — it's to add `"types": ["node"]` (or a `lib`/global for
`console`) to tsconfig.pure.json. I did NOT change the shared tsconfig (multiple agents
affected, outside my file's scope). Whoever owns the M2 tsconfig wiring must add node types
to the pure config. NOTE: vitest runs fine regardless (tsx provides `console`), so
`npx vitest run src/content/cadenceLibrary.test.ts` is green — only the `tsc` purity
typecheck is affected.

### check-purity.sh false-positive on the literal string "Math.random"

The purity grep is `grep -F "Math.random"` over `*.ts` — it matches the substring even in
a COMMENT. My first draft had "no Math.random()" in a doc comment and tripped it. Reworded
to "no use of the global random generator". Same trap the fretboard note flagged for DOM
words; the rule generalizes: never write the banned tokens (`Math.random`, `document`,
`window`, `navigator`) in prose inside pure/seeded modules.

## Milestone 2 — content: motifs.json + motifLibrary

### `console` is NOT available under tsconfig.pure.json

The pure build (`tsconfig.pure.json`) sets `lib: ["ES2022"]` with NO DOM lib and pulls
in NO `@types/node`. So `console.log(...)` in any pure module (domain/fretboard/content/
generator/musicxml/evaluation) is a COMPILE ERROR: `TS2584: Cannot find name 'console'`.
The grep-based `verify:purity` does NOT catch this (it only bans electron/react/DOM
globals + Math.random + ": any"), so the only guard is `npx tsc -p tsconfig.pure.json`.
Net: the brief's "[CONTENT]/[GEN] structured logging" cannot live inside pure modules at
load/validate time. Decision for motifLibrary: drop the success log; rely on LOUD throws
for the only branch that must report. If logging in pure code is wanted later, inject a
logger via a param, or add `"node"` to the pure config's `types` (changes the contract).
NOTE: a sibling agent's cadenceLibrary.ts hit the identical `console` error — this is a
shared gotcha for every content loader, not a one-off.

### JSON content loads via static import, not fs

`tsconfig.base.json` has `resolveJsonModule: true` and the runtime is Vite/vitest, so
`import motifsData from './data/motifs.json' with { type: 'json' }` works identically
under `tsc` and under vitest with ZERO fs/path I/O. This keeps the loader a pure module
(no node `fs`, which would also be untyped under the pure config) and is the right
pattern for progressions/cadences/fallbackLines too. Use the `with { type: 'json' }`
import-attribute form (not the deprecated `assert`).

### Motif tick arithmetic that fills exactly one 4/4 bar (1920 ticks)

Verified building blocks (480/quarter): eighth=240, sixteenth=120, dotted-quarter=720,
dotted-eighth=360, half=960, dotted-half=1440, whole=1920. Tuplets: eighth-triplet=160
(12 fill a bar), quarter-triplet=320 (6 fill a bar). The Charleston is specifically
[720, 240, 960] in that order (dotted-quarter, eighth, half) per the brief. Authored 16
motifs; an independent `node` reduce over the raw JSON confirmed every one sums to 1920
before trusting the loader's own validator (belt-and-suspenders for content this is the
"single most important transferable artifact" family).

### Validation must fail LOUDLY with a typed error

`validateMotifs` throws a dedicated `MotifValidationError` (subclass of Error) so callers
and tests can `toThrow(MotifValidationError)` rather than matching a string. Unknown time
signatures also throw (only '4/4' is mapped for the starter set) — silent acceptance of
content the generator can't place is the worst outcome (brief s8).

---

## Milestone 2 — content: progressions library

### `check-purity.sh` greps SOURCE TEXT, including comments/strings

`verify:purity` uses `grep -F "Math.random"` over `src/content` and `src/generator`.
A comment that merely *mentions* `Math.random()` (e.g. "no Math.random() here") trips
the check even though no call exists. Same hazard for the DOM-globals word-boundary
grep on `document|window|navigator`. Rule of thumb in pure modules: never write the
banned tokens in prose. I rephrased the header comment to "only seeded PRNG (none
needed here)".

### JSON import for content libraries

`tsconfig.base.json` has `resolveJsonModule: true`, and the runtime is ESM (`"type":
"module"`). Imported the placeholder content with an import attribute:
`import data from './data/progressions.json' with { type: 'json' };`
Works under vitest/tsx and typechecks under `tsconfig.pure.json`. The imported value is
typed `unknown`-ish, so the loader narrows it structurally (no `: any`, which is banned
in content) before returning typed `ProgressionEntry[]`.

### Roman-numeral "parseable" check mirrors domain/chord.ts

`romanNumeralToChord` needs a concrete Key, but `loadProgressions` validates Roman
numerals *key-agnostically* at load time. I replicated `parseRoman`'s front-anchored
`/^[ivIV]+/` extraction and then required the (lowercased) letters to name a known
degree i..vii. Trailing quality markers (7, o, +, ø, dim) are ignored — the explicit
`quality` field is authoritative, matching the domain layer's contract. Note this means
the JSON `quality` enum is the real source of truth; the numeral's case is informational.

### Validation policy beyond the brief's three checks

Brief section 8 names barIndex-range / numeral-parseable / enum-valid. I also enforce:
unique ids, difficulty in 1..5, applicableKeys = "all" | string[], and **every bar
covered by >=1 chord** (so selectProgression never hands the generator a harmonically
empty bar). `validateProgressions(entries)` is exported separately from
`loadProgressions()` so tests can feed in-memory broken fixtures; it re-runs the
field-level narrowing so an in-memory fixture is held to the same standard as JSON.

---

## Milestone 2 — MusicXML serializer (`src/musicxml/serialize.ts`)

Single export: `serializeLineToMusicXML(line: Line): string`. Hand-written
score-partwise 3.1 serializer for the single-voice subset. 28 tests green;
`tsc -p tsconfig.pure.json` clean for this module; `verify:purity` clean.

### divisions == TICKS_PER_QUARTER (480), so `<duration>` IS the tick count

Setting `<divisions>480</divisions>` means a note's MusicXML `<duration>` equals its
`Duration.ticks` verbatim — no scaling, no rounding. This is the cleanest possible
choice and the reason 480 was picked as the tick resolution in the first place.
Dotted quarter -> 720, eighth triplet -> 160, sixteenth -> 120 all serialize directly.
Keep divisions == tick resolution in the Swift port; any other value forces a
conversion (and rounding bugs on tuplets).

### `<note>` child ordering is DTD-significant — get it exactly right

OSMD is lenient but MuseScore (the human's audition tool) validates against the DTD,
which fixes the child order. The order I emit, verified rendering-correct:
`pitch|rest`, `duration`, `tie*`, `voice`, `type`, `dot*`, `accidental`,
`time-modification`, `notations`. Two easy mistakes: putting `<accidental>` before
`<dot>` (wrong — accidental comes AFTER dots), and putting `<tie>` after `<voice>`
(wrong — `<tie>` is right after `<duration>`). Note the split: `<tie>` (before
`<voice>`) is the *sounded* tie for playback; `<tied>` (inside `<notations>`, at the
end) is the *visual* curved line. Both are needed; a renderer may show nothing if you
emit only one.

### Guitar clef = treble G/line-2 + `<clef-octave-change>-1`

Guitar reads at written pitch on a treble clef but sounds an octave lower; the octave
shift is declared ONCE in the first measure's `<attributes><clef>`, NOT applied to the
pitch octaves. So a written/spelled C4 in the Line stays `<octave>4</octave>` — do NOT
subtract an octave from the pitch data. The clef element carries the -1.

### key fifths derived from domain `keySignature`, not re-derived

`keySignature(key)` already returns `{sharps:n}|{flats:n}`; `<fifths>` = `sharps` or
`-flats`. I re-implemented `signatureAccidentals(fifths)` locally (it's not exported
from domain/key.ts) ONLY to compute the accidental-display baseline — it mirrors the
canonical sharp order F C G D A E B / flat order B E A D G C F. If domain ever exports
that map, drop the local copy.

### Accidental display = per-measure running state keyed by STAFF POSITION

The rule: show an explicit `<accidental>` only when a note's spelling differs from
what is currently in effect at its staff position (letter+octave) this measure. Baseline
per measure = the key-signature accidental for that letter; it RESETS every barline.
Tracking is keyed by `name+octave` (e.g. `"F4"`), not by letter alone, because a
courtesy accidental on F4 does not silence one needed on F5. Consequences, all tested:
F# in G major shows no accidental (in the signature); F-natural in G major shows an
explicit `<natural>` (cancels the signature sharp); F# in C major shows `<sharp>`; a
second F# in the same measure shows nothing; the same F# in a new measure shows the
sharp again. Note `<alter>` (the SOUNDING semitone offset) is ALWAYS emitted regardless
of accidental display — alter and accidental are independent: alter says what it sounds,
accidental says what glyph to draw.

### Ties span barlines — thread tie-stop state across measures

`LineNote.tiedToNext` is a START flag. The matching STOP lands on the *next note in
time order*, which may be the first note of the NEXT measure. Because I serialize
measure-by-measure (notes grouped by `barIndex`), I compute a `tieStopFirst` flag for
each measure from the previous measure's last note (`prevLast.tiedToNext &&
samePitch(prevLast, thisFirst)`) and thread it in. Within a measure, a note's stop is
read off `notes[i-1].tiedToNext`. Guard with a same-spelled-pitch check so a stray
`tiedToNext: true` between different pitches can't emit a bogus tie.

### Tuplet bracketing: time-modification on EVERY note, bracket only at ends

Every note in a tuplet run carries `<time-modification>` (actual=numerator,
normal=denominator, e.g. 3/2 for an eighth triplet). But the visual `<tuplet>` bracket
in `<notations>` is drawn only on the first (`type="start"`) and last (`type="stop"`)
note of a maximal run of consecutive tuplet notes within the measure; inner notes get
none. I classify each note start/inner/stop/none by looking at prev/next tuplet-ness.
First draft used a module-level mutable `_tupletRunOpen` flag — refactored that out to
an explicit `TupletBracket` param computed in the measure loop (module-level mutable
state in a "pure" serializer is a footgun if it's ever called re-entrantly).

### Same prose hazard as every other pure module: the word "document"

`check-purity.sh` greps `document|window|navigator` as whole words over `*.ts`,
including comments and test `describe` names. "document structure"/"document string"
in my prose tripped it. Reworded to "score structure"/"XML string". The running rule
across this codebase: never type `document`, `window`, `navigator`, or `Math.random`
as plain words anywhere in a pure/seeded module, even in comments.

### Pre-existing blocker observed (NOT mine to fix): `console` under pure tsconfig

`npx tsc -p tsconfig.pure.json --noEmit` fails on `src/content/cadenceLibrary.ts:197`
(`TS2584: Cannot find name 'console'`) — the same `console`-under-no-DOM-lib issue prior
content-loader notes flagged. My musicxml module has zero errors under that config
(verified by a scoped typecheck of just serialize.ts + serialize.test.ts). Whoever owns
the pure tsconfig still needs to add `"types": ["node"]` (or a console global) so the
content loaders' mandated structured logging typechecks.

---

## Generator (Milestone 2)

The generator is 10 pure pipeline stages orchestrated by `generateLine(config, seed,
generatedAt)`. One `seedrandom` PRNG is created per attempt from the string `"${seed}:${attempt}"`
and threaded by reference through every stage, so a line is a pure function of its inputs.

### Determinism mechanics (carry to Swift)

- **`generatedAt` is an injected parameter, never read from a clock.** The clock-reading
  and current-timestamp APIs are grep-banned in `src/generator` (verify:purity + the M2
  grep). The line `id` is a deterministic FNV-1a hash of `(seed + JSON.stringify(config))`
  shaped like a UUID — NOT a random/crypto UUID — so the same inputs always reproduce the
  same id. Two `generateLine` calls with identical args are byte-identical under
  `JSON.stringify`.
- **Retries advance the RNG via the attempt counter folded into the seed string**, so each
  outer retry explores a different sequence while `(seed, attempt)` stays reproducible.
- **`console` is not in the pure tsconfig lib.** The generator routes its one structured
  log through `src/generator/log.ts`, which ambiently `declare const console` with a
  minimal surface. This keeps `[GEN]`-prefixed logging without adding a DOM/Node dep. (The
  pre-existing `cadenceLibrary.ts` `console.log` was a latent pure-compile break; removed.)

### Purity-script gotchas (cost real time — document for the rewrite tooling)

`scripts/check-purity.sh` greps SOURCE TEXT, including comments:
- It word-matches `window|document|navigator`. Comments using the bare word "window"
  (e.g. "working window") tripped the DOM-global check. Renamed those to "register band".
  Identifiers like `STRONG_BEAT_TARGET_WINDOW` are safe (case-sensitive, and `_WINDOW` is
  part of a larger token).
- It substring-matches `Math.random`. Comments that merely MENTION `Math.random` fired the
  check. Reword prose to avoid the literal.
- The M2 acceptance grep also bans the literal `Date.now()` / `new Date(` substrings, so
  comments must avoid those literals too.

### Tuning surface (`src/generator/tuning.ts`)

Single file, every weight/threshold a named constant with a comment. The levers that
mattered most, in order of impact on output quality:

1. **`CONTOUR_WORKING_RANGE_SEMITONES = 12`** — the single biggest fix. A guitar NeckPosition
   spans ~2 octaves, and naively placing strong beats across the full span made the
   strong-beat SKELETON leap constantly (~28% stepwise) and blew the total-range check. We
   confine each line to a randomly-placed ~1-octave register band inside the position. This
   alone lifted the skeleton toward conjunct motion and kept range under control.
2. **`STRONG_BEAT_MAX_LEAP = 5` + `STRONG_BEAT_TARGET_WINDOW = 7`** — hard-filter strong-beat
   chord-tone candidates to those within a 4th of the previous strong beat AND near the
   bar's contour target. Skeleton stepwise fraction rose to ~46%.
3. **`W_STEP_PREFERENCE = 2.5`** in weak-beat fill — a flat reward for moving by step
   (1-2 st) from the previous note, plus mild penalties for unison repeats (-0.5) and
   large leaps (-1.5). Since most notes are weak beats, this is the dominant lever on the
   OVERALL mix. With it, the realized mix landed at ~0.73 step / 0.21 small-leap / 0.06
   large — right on the brief's 70/25/5 target.
4. **`SAMPLING_TEMPERATURE = 0.7`** — softmax over candidate scores. Low enough to keep
   choices sensible, high enough to vary across seeds.

`STEP_LEAP_TOLERANCE = 0.18` is deliberately loose: short lines (2-bar, few intervals)
have coarse fractions, so a tight tolerance would force constant retries/fallbacks on them.

### Which validators fire (telemetry from the property run)

Property run: **1080 lines across 6 keys x 3 positions x {2,4} bars x {none,low,medium}
accidentals**. Result: **4 fallbacks (0.37%, well under the 5% gate), avg 2.10 attempts/line.**

- **`validateMusicality` is essentially the only validator that fires** (~1191 fires over
  the run; `validatePosition` and `validateCadence` almost never fail because placement is
  constrained to the position and the cadence pitch is pinned first).
- Within `validateMusicality`, the breakdown (separate instrumented run) was roughly:
  **step/leap ~90%, range ~7%, contour-realization ~3%, repeated-notes <1%.** The step/leap
  mix dominates because short lines have high fraction variance. This is the natural knob
  to relax (`STEP_LEAP_TOLERANCE`) if fallback rate ever creeps up after content changes.

### Architectural notes

- **The cadence constrains the ACTUAL last (and penultimate) sounding note, not the last
  strong beat.** Early version pinned the cadence pitch on the last strong-beat slot; when
  the final note was a weak beat the line ended on the wrong pitch and `validateCadence`
  fired constantly. Fix: `placeStrongBeatPitches` pins `slots[last]` (and `slots[last-1]`
  when `constrainsPenultimate`), and `fillWeakBeatPitches` treats ANY pre-placed slot as a
  fixed anchor (not just strong beats).
- **Progression tiling.** Starter content only authors 2- and 4-bar progressions, but the
  brief allows barCount 2..16. `selectProgression` tiles a compatible shorter progression
  (preferring ones whose bar count divides the target; tile-and-truncate for odd counts
  like 3/5). So any bar count works without authoring 14 more progressions.
- **Rhythm variations preserve total bar length.** `displacement` rotates onsets,
  `augmentation` merges two events, `omission` extends the previous note over the last —
  all keep the per-bar tick sum at exactly `ticksPerBar`, which the bar-fill invariant and
  validators rely on absolutely.

### Fallbacks

`scripts/authorFallbacks.ts` generates the fallback lines by running OUR pipeline with
`allowFallback:false` over boring known-good configs (C major, open position, difficulty 1,
no accidentals), scanning seeds until each bar count yields a clean line, then serializing
the `Line` objects to `src/content/data/fallbackLines.json`. Regenerate after any generator
change: `npx tsx scripts/authorFallbacks.ts`. `getFallbackLine` re-stamps the caller's seed
and injected `generatedAt` so even the fallback path is deterministic, and tags
`validationsPassed: ['fallback']` so callers/telemetry can tell a fallback from a real line.

## Milestone 2 — batch CLI (`src/cli/generateBatch.ts`) & property-test gate

### `src/cli` is NOT a pure module — but `src/generator` (incl. its tests) IS

`check-purity.sh` lists pure dirs as `domain fretboard content generator musicxml
evaluation`. `cli` is absent, so `generateBatch.ts` freely uses `node:fs`/`node:path` and
the real Node `console`. The flip side: `src/generator/property.test.ts` lives in a pure
dir, so it is compiled under `tsconfig.pure.json` (no DOM, no `@types/node`) where bare
`console` is a compile error. To PRINT the required fallback-rate/telemetry breakdown from
the property test, route through the generator's `genLog()` (the `[GEN]` ambient-console
shim), NOT `console.log`. Same trick the generator already uses.

### Vitest swallows stdout by default — telemetry "prints" but you won't see it

`vitest run` intercepts `console` and only shows it on failure. The property test's
`genLog` telemetry summary is emitted but hidden on a green run. Use
`vitest run --disableConsoleIntercept` to actually see the `[GEN] property-test telemetry
summary` block. The numbers still compute and assert regardless of visibility.

### Determinism in the CLI = inject a FIXED `generatedAt`, never read the clock

`generateBatch.ts` hardcodes `FIXED_GENERATED_AT = '2026-06-04T00:00:00.000Z'` and passes
it to every `generateLine` call, exactly mirroring the generator's clock-free contract.
Result: same flags + `--seed` => byte-identical `.xml` AND identical `telemetry.json`
(verified with `diff -q`). Line k uses `baseSeed + k`. This is what makes the batch
re-runnable for the human's audition without churn.

### CLI config precedence: defaults < `--config` JSON < individual flags

`buildConfig` layers `DEFAULT_CONFIG`, then a `--config <path>` partial `LineConfig`, then
each CLI flag overrides. Verified: `--config` set bars/tempo/acc, then `--key`/`--position`
flags overrode on top. The `LineConfig` is JSON-safe so the `--config` file is literally a
serialized config (same shape persisted to session/preset rows later).

### Position-spec flag ordering bites: `--position strings:frets`, strings 1..6

`--position 1-6:7-11` = strings 1..6, frets 7..11. Writing it backwards
(`--position 7-11:1-6`) passes string number 7 to the fretboard, which throws
`invalid string number 7` — a genuine config error that (correctly, per "let it crash")
crashes rather than being swallowed. Remember STRING NUMBERING IS INVERTED (1 = low E).
A bare `--position 4-8` means "all strings, frets 4..8".

### Property test asserts the cadence ending INDEPENDENTLY of the validator

The generator's `validateCadence` already guarantees a valid ending, so a tautological
property check would prove nothing. The property test instead REPLAYS the deterministic
context/progression/cadence selection (`makeRng(seed, attempt)` over the first 10 attempts,
unioning the allowed pitch classes) and asserts the line's final pitch class is in that
set. The union-over-attempts is needed because a line may have succeeded on any attempt;
an empty allowed set (role filtered out by accidentals) is treated as "any pc valid",
matching `validateCadence`'s own fallback behavior.

### Range invariant uses validator constant + a configurable margin

Brief: "total range <= ~1.5 octaves (allow a configurable margin)". The property test bound
is `MAX_RANGE_SEMITONES + RANGE_MARGIN_SEMITONES` (19 + 1 = 20). Non-fallback lines are
already <= 19 by `validateMusicality`; the margin keeps the property assertion decoupled
from the exact validator constant so tuning one doesn't silently make the other vacuous.

## Property test (property.test.ts) is adversarially verified — invariants genuinely enforce

The 1,000-line property test does NOT use named "invariant helper" functions; it inlines
each check directly in the `it` body. The genuine rejection logic lives in shared helpers it
imports/recomputes:
  - position: `isPlayableInPosition` (fretboard) — same fn `validatePosition` uses.
  - rhythm-fills-bar: inline per-bar tick sum vs `ticksPerBar`.
  - cadential ending: the (non-exported) `cadenceTargetPcs` closure, built from
    `buildGenerationContext`/`selectProgression`/`selectCadence`/`playableForRole`.

Negative-probe result (temp test, since deleted): each check REJECTS a deliberately bad
input (out-of-position MIDI 88 in open pos; a half+quarter bar = 1440 != 1920; a final pc
not in the cadence target set). So none of the three is vacuous.

Caveat surfaced for cadence: if a (config,seed)'s `playableForRole(...).to` set is empty,
both the validator (validateCadence) and `cadenceTargetPcs` treat the ending as
"any pc is valid" (cadenceTargetPcs unions all 12). For configs where every attempt's role
is unplayable, the cadence assertion becomes vacuous-by-design for THAT line. With the
property test's 6 keys / open+V+VIII positions / accidentalsDensity none|low|medium, the
diatonic tonic/leading-tone targets are reliably playable, so this degenerate case is not
hit in practice — but it is the one spot where the cadence invariant can silently pass.

Fallback counting is correct and the <5% gate executes: `total++` is unconditional;
`isFallback = usedFallback || validationsPassed.includes('fallback')` (both signals agree —
getFallbackLine stamps `['fallback']`, generateLine fires `usedFallback:true`); `continue`
only skips per-line asserts inside the loop, never the post-loop `expect(fallbackRate).toBeLessThan(0.05)`.
Live run: 1080 lines, 4 real fallbacks counted (rate 0.37%), validateMusicality fired 1191x —
so fallbacks are counted (not swallowed) and the assertion runs on a real, non-zero rate.

## MusicXML adversarial verification (VERIFY_SCHEMA)

Verified 46 generated lines across 8 batches (C/F#/Gb/Eb/Cb major, A/C/C# minor;
accidentalsDensity none..high) plus targeted synthetic lines, via a DOM-parser
structural checker (scripts/verify-musicxml.mts, uses happy-dom DOMParser) that
cross-checks every element against the in-memory Line ground truth. Result: 0
structural problems. clef-octave-change=-1, divisions=480, fifths matched the key,
time sig matched, step/alter/octave matched spelling, and explicit accidentals
matched an independently re-derived expectation (35/46 lines carried >=1 true
chromatic accidental; none redundant vs key sig; <alter> omitted when 0).

KEY GAP: the current generator emits NO ties, NO rests, and (at difficulty 1-3)
NO tuplets — annotateNotes.ts hard-codes tiedToNext:false (comment line 57), motifs
are all-notes (no rest slots), and tuplet motifs only get sampled at difficulty 5
(75/300 lines at diff 5 had tuplets; 0 at diff 3). So real generated XML never
exercised the serializer's tie/rest paths. I exercised them with synthetic Lines:
rests, ties-within-bar, cross-barline ties, and 3-note tie chains all serialize and
parse correctly. Tuplet-bearing GENERATED lines (diff 5, 25 sampled) all parse with
correctly paired <tuplet start/stop> brackets.

LATENT SERIALIZER BUG (currently unreachable): serialize.ts emits <tie type="start">
+ <tied type="start"> purely from ln.tiedToNext (lines 228/257), but only emits the
matching STOP when the NEXT note shares the same spelled pitch (writeMeasure tieStop,
lines 302-309; cross-bar tieStopFirst, lines 392-398). If a Line ever has
tiedToNext:true between DIFFERENTLY-spelled notes, the serializer produces an ORPHAN
tie start (1 start / 0 stops) -- well-formed XML but semantically invalid MusicXML
(a tie that never resolves). Not reachable today because the generator always sets
tiedToNext:false. Fix when ties are added: gate the tie-START emission on the next
note sharing the same spelling (mirror the existing STOP-side guard), or assert in a
validator that tiedToNext only links identical pitches.

OSMD HEADLESS (verify item 4): under happy-dom, OSMD's MusicXML reader LOADS a
generated file fine -- inst.load(xml) yields Sheet=true, SourceMeasures.length=4 --
which is independent third-party confirmation of structural validity. The full SVG
RENDER fails ("Cannot set properties of null (setting 'font')") because happy-dom has
no real canvas/SVG text-measurement layer. So: load/parse verification works headless;
full visual render verification is deferred to the Electron milestone (as anticipated).

CONTENT-LIBRARY LIMITATION (not an XML bug): generateBatch with --time 6/8 or 3/4
CRASHES in planRhythm ("no motif for timeSignature=6/8 difficulty<=3") because
motifs.json only contains 4/4 motifs. The TimeSignature serialization itself is fine
for any beats/beat-type; the gap is missing 3/4 and 6/8 starter motifs.

## MusicXML serializer — orphan-tie bug FIXED (post-verification)

The LATENT orphan-tie bug above is now fixed in serialize.ts. Root cause: the tie
START (`<tie type="start"/>` + `<tied type="start"/>`) was emitted unconditionally
from `ln.tiedToNext`, while the STOP was (correctly) gated on the next sounded note
having identical spelling. Asymmetric guards => a `tiedToNext:true` note before a
differently-spelled (or absent) successor produced 1 start / 0 stops.

Fix: made the START emission symmetric with the STOP. `writeNote` no longer reads
`ln.tiedToNext` itself; it takes a `tieStart: boolean` computed by `writeMeasure`:
START is emitted only when `tiedToNext && nextNote shares the same spelled pitch`
(interior), or for the bar's last note when the next bar's first note matches.
The cross-bar resolution is computed once per measure (`crossBarTieResolves[i]`)
and reused for BOTH the START gate of measure i and the STOP gate of measure i+1,
so start/stop counts are always balanced by construction. Verified on the exact
synthetic case (C5-half tiedToNext:true -> D5-half): now 0 starts / 0 stops.

Regression tests added to serialize.test.ts (4 new): no orphan within-bar, no
orphan cross-bar, no start on the very last note, and a mixed-tie balance check
(valid within-bar C4-C4 pair + an invalid cross-bar intent => starts == stops == 1).
Full suite: src/content+generator+musicxml 117 pass; property-test fallback 0.37%.

NOTE FOR SWIFT REWRITE: keep tie START and STOP emission symmetric — derive BOTH
from "this note and its successor share the same spelled pitch AND the predecessor
set tiedToNext", never from `tiedToNext` alone. A tie is a property of an *edge*
between two identically-spelled notes, not a flag on a single note. Equivalently,
when ties are actually introduced into the generator, enforce in a validator that
`tiedToNext` only ever links identical spellings, so the flag and the edge agree.

## Milestone 2 FINALIZED — HUMAN REVIEW GATE 1 (musicality) reached

Status: all objective M2 gates are GREEN and the audition artifacts are produced.
The musicality judgment itself is the human's (a STOP-AND-REVIEW gate, brief s.14);
the agent does not self-certify it.

### Objective gate results (this run)

- `npm run verify` is fully green. It now chains three steps explicitly so the
  1,000-line run is unambiguous in the gate: `vitest run && npm run verify:property
  && npm run verify:purity`. (The property test already runs inside `vitest run` via
  the `src/**/*.test.ts` include; the explicit re-run is for legibility of the gate.)
  Result: 21 test files / 249 tests pass; property test passes; purity clean.
- Property run (`verify:property`, console-visible via `--disable-console-intercept`):
  **1080 lines, 4 fallbacks = 0.37% (< 5% gate PASS), avg 2.10 attempts/line, validator
  failures `{validateMusicality: 1191}`** — consistent with the earlier instrumented run.

### Audition batch (the Gate-1 deliverable)

30 lines across **3 representative configs** in `out/audition/` (gitignored — the output
is regenerable byte-for-byte from the seeds, so it is NOT committed; the code + content +
this file are the committed deliverables). A top-level `README.md` and
`telemetry-summary.json` sit alongside the three config subdirs.

| Config | Key | Position | Bars | Tempo | Diff | Acc | seeds | avg attempts | fallbacks |
|--------|-----|----------|------|-------|------|-----|-------|--------------|-----------|
| 1 | C major  | open 0-5   | 4 | 80  | 2 | none | 1000-09 | 2.40 | 0 |
| 2 | A minor  | 5th 4-8    | 4 | 100 | 3 | low  | 2000-09 | 1.30 | 0 |
| 3 | Eb major | 8th 7-11   | 2 | 120 | 3 | low  | 3000-09 | 2.10 | 0 |

Batch totals: 30 lines, **0 fallbacks**, ~1.93 attempts/line, only `validateMusicality`
ever rejected an attempt (28 fires total: 14 + 3 + 11).

### New tuning discovery: difficulty-1/2 + open position retries MORE than mid-neck

Counterintuitively, the *easiest* config (C major, open, difficulty 2, no accidentals)
needed the **most** retries (2.40 attempts/line, 14 musicality fires), while A-minor 5th
position at difficulty 3 needed the **fewest** (1.30, 3 fires). Why: the open-position
window (frets 0-5, all strings) and a no-accidentals filter give a SMALL diatonic pitch
pool inside the contour's ~1-octave working band, so the weak-beat fill keeps colliding
with the step/leap target and the no-more-than-3-repeats rule, forcing retries. Mid-neck
positions expose more octave duplicates of each pitch class, so the placer has more room
to satisfy stepwise motion on the first pass. Takeaway for the human/Swift: **retry rate
is driven by pitch-pool size (position width x accidental density), not by `difficulty`.**
If a narrow/low-accidental config ever pushes fallback rate up after content edits, widen
its working band or loosen `STEP_LEAP_TOLERANCE` rather than touching difficulty.

### Which validator fired (audition + property agree)

`validateMusicality` is, again, the ONLY validator that fires in practice across all
configs. `validatePosition` and `validateCadence` never fired in either the 1,080-line
property run or the 30-line audition batch — because placement is hard-constrained to the
position and the cadence/penultimate pitches are pinned before weak-beat fill. The
musicality knob (`STEP_LEAP_TOLERANCE`, `CONTOUR_WORKING_RANGE_SEMITONES`,
`W_STEP_PREFERENCE`) is therefore the entire effective tuning surface for fallback rate.

### Schema / artifact notes from this milestone

- No schema changes this milestone. `LineConfig` stayed flat and JSON-safe; the CLI's
  `--config` file is literally a serialized `LineConfig`, and the per-config
  `telemetry.json` shape (`BatchTelemetry` in `generateBatch.ts`) is what a future stats
  view over generation quality would read.
- The fallback filename tag (`-fallback`) is a cheap, durable signal: a human scanning the
  output dir sees instantly whether any line came from `fallbackLines.json`. None did.
- MusicXML extension: files are written as `.xml` (MusicXML 3.1 partwise). MuseScore and
  OSMD both open `.xml`; no need to rename to `.musicxml`. Treble clef carries
  `clef-octave-change -1` so the staff reads at guitar pitch (sounds an octave lower).

### How a future run reproduces the audition

Deterministic. Re-running the three CLI commands in `out/audition/README.md` with the same
flags+seeds reproduces byte-identical files and telemetry. Regenerate fallbacks first if
the generator changed: `npx tsx scripts/authorFallbacks.ts`.
