# Sight-Reading App — Electron Prototype Build Brief

**Audience:** Autonomous coding agent (Claude Code, workflow mode)
**Purpose:** Build a throwaway Electron prototype that validates the music generator, data schema, and core UX before a native Swift rewrite.
**Status:** Ready to build
**Last updated:** April 2026

---

## 0. How to use this document

This is an executable build brief. Work through the milestones in section 12 in order. Each milestone has explicit deliverables and acceptance criteria. Acceptance criteria are of two kinds:

- **Automated/objective criteria** — verifiable by running tests or scripts. You must make these pass before considering a milestone complete.
- **Human review gates** — subjective judgments (primarily musical quality) that you cannot evaluate yourself. When you reach one, build the tooling that lets the human evaluate it, produce the artifacts they need (e.g. a batch of MusicXML files), and explicitly stop and report that a human review gate has been reached. Do not self-certify musical quality.

Build in vertical slices where possible, but the milestones are sequenced so that each builds on the last. Commit after each milestone with a descriptive message. Keep a running `LEARNINGS.md` file (see section 14) documenting non-obvious discoveries — this file is the most important deliverable of the entire prototype.

This is throwaway code. Optimize for clarity and speed of iteration, not for production robustness. Do not build authentication, error-recovery frameworks, or abstractions for future flexibility. The native Swift app will be a clean rewrite; nothing here needs to be reusable except the **data schema**, the **content library JSON files**, and the **documented learnings**.

---

## 1. Project overview

The product is a sight-reading practice tool for intermediate-to-advanced guitarists. The user is shown a generated line of standard notation, plays it on guitar (input via audio interface), and receives real-time feedback and post-line accuracy metrics. Lines are generated fresh, played once, and discarded — this is sight reading, not drilling.

This prototype validates three things before committing to a native build:

1. **Generation quality** — does the rule-based generator produce musically coherent lines?
2. **Data schema** — does the proposed schema support the statistics the product needs?
3. **Core UX** — do the real-time feedback mechanics and session flow feel right in practice?

The prototype is explicitly NOT validating audio latency or performance (Web Audio in Electron has higher latency than native Core Audio; this is accepted and out of scope for evaluation).

---

## 2. Scope

### In scope for this prototype

- Pure-TypeScript music generator producing single-voice melodic lines as MusicXML.
- A starter content library (progressions, rhythmic motifs, cadences) sufficient to make the generator run. NOTE: the musical quality of this content is the human's responsibility to refine later; you author a minimal valid placeholder set.
- Notation rendering via OpenSheetMusicDisplay (OSMD).
- A metronome-driven cursor that advances in musical time.
- Real-time monophonic pitch detection from an audio interface input.
- Note-by-note evaluation with real-time feedback coloring.
- Post-line results screen with separated pitch and timing accuracy.
- A session loop ("next line" treadmill).
- Persistence of sessions, line attempts, and note events to SQLite.
- One or two basic statistics views querying that data.
- A batch-generation CLI for auditioning generator output.

### Explicitly out of scope

- Audio latency optimization or evaluation.
- UI visual polish (functional/ugly is correct).
- User accounts, authentication, multi-user.
- Cloud sync, networking of any kind.
- LLM-assisted generation (rule-based only).
- Alternate tunings (standard EADGBE only).
- Drill mode, spaced repetition, persisted/replayable lines as a tracked feature.
- Chord progression practice, scales tool, arpeggios tool (future product tools, not this prototype).
- Tab notation display.
- Adaptive within-session difficulty.
- Chord extensions beyond the seventh (9ths/11ths/13ths).
- The full statistics suite (only 1–2 views needed to validate the schema).

---

## 3. Locked design decisions

These are settled. Do not deviate without flagging.

- **String numbering is INVERTED from guitar convention: string 1 = low E, string 6 = high E.** Document this prominently in the domain model. Every function taking a string number must note the convention.
- **Tick resolution: 480 ticks per quarter note** (MIDI/MusicXML standard).
- **Enharmonic keys are distinct.** F♯ major and G♭ major are separate keys with separate spelling. 30 keys total (15 major + 15 minor, enharmonic pairs counted separately).
- **Generator is stateless.** Each line is a pure function of `(config, seed)`. No session memory, no cross-line diversity tracking.
- **Rule-based generation only.** No LLM calls anywhere.
- **Chord vocabulary ceiling: seventh chords.** No extensions.

### Decisions made for this brief (human may override)

- **Standard tuning only (EADGBE, low to high).** Alternate tunings deferred.
- **Content libraries authored as JSON files** — simple, portable, version-controlled, and directly reusable in the Swift rewrite.
- **Seeded PRNG via `seedrandom`** — reproducibility is mandatory; `Math.random()` is forbidden in the generator.
- **Default line length: 4 bars.** Configurable 2–16.

---

## 4. Tech stack

- **Runtime:** Electron (latest stable).
- **Language:** TypeScript (strict mode on).
- **Build:** Vite + electron-vite (or equivalent fast HMR setup).
- **UI:** React 18+. Plain CSS or minimal utility CSS. No heavy component library; if one is wanted, use shadcn/ui sparingly.
- **Audio input:** Web Audio API. `getUserMedia` for interface access, `AudioWorkletNode` for pitch detection off the main thread.
- **Pitch detection:** `pitchy` (JavaScript YIN/McLeod implementation) as the starting point. If accuracy is insufficient for clean single-note guitar input, escalate to CREPE via TensorFlow.js and flag this to the human.
- **Notation:** `opensheetmusicdisplay` (OSMD).
- **Persistence:** `better-sqlite3` in the Electron main process. Schema via numbered SQL migration files.
- **PRNG:** `seedrandom`.
- **Testing:** `vitest` for unit and pipeline tests.
- **MusicXML serialization:** hand-written serializer for the single-voice subset needed (do not pull in a heavy notation library for this).

---

## 5. Project structure

Organize as TypeScript modules with clear separation. The non-UI modules are the ones that matter conceptually (they map to Swift packages later).

```
/src
  /domain          # Pure music types & utilities. No I/O, no deps on other modules.
    pitch.ts
    key.ts
    chord.ts
    interval.ts
    duration.ts
    timeSignature.ts
    neckPosition.ts
    line.ts         # The Line type and LineNote type
    index.ts
  /fretboard       # Fretboard model & position→pitch mapping. Depends on domain.
    tuning.ts
    fretboardModel.ts
    positionMapping.ts
  /content         # Loads & validates JSON content libraries.
    progressionLibrary.ts
    motifLibrary.ts
    cadenceLibrary.ts
    /data
      progressions.json
      motifs.json
      cadences.json
      fallbackLines.json
  /generator       # The generation pipeline. Depends on domain, fretboard, content.
    context.ts
    selectProgression.ts
    selectPhraseStructure.ts
    planRhythm.ts
    selectContour.ts
    selectCadence.ts
    placeStrongBeats.ts
    fillWeakBeats.ts
    validators.ts
    generateLine.ts   # Top-level orchestrator
    fallback.ts
  /musicxml        # Line → MusicXML serialization. Depends on domain.
    serialize.ts
  /persistence     # SQLite access. Depends on domain.
    db.ts
    /migrations
      001_initial.sql
    sessions.ts
    lineAttempts.ts
    noteEvents.ts
    presets.ts
  /audio           # Web Audio: metronome, input, pitch detection.
    metronome.ts
    pitchDetector.ts
    audioGraph.ts
  /evaluation      # Aligns detected input to expected line, classifies notes.
    align.ts
    classify.ts
    metrics.ts
  /ui              # React components. The disposable layer.
    /components
    /views
    App.tsx
  /cli             # Batch generation CLI for auditioning.
    generateBatch.ts
/tests
LEARNINGS.md
```

Rule: `/domain`, `/fretboard`, `/content`, `/generator`, `/musicxml`, `/evaluation` must have NO dependency on Electron, React, or the DOM. They are pure logic and must be unit-testable in isolation under vitest. This discipline is what makes the schema and generator design transferable to Swift.

---

## 6. Domain model specification

Implement these types in `/src/domain`. TypeScript shown is the target shape; refine as needed but preserve semantics.

### Pitch

```typescript
type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
type Accidental = 'natural' | 'sharp' | 'flat' | 'doubleSharp' | 'doubleFlat';

interface Pitch {
  name: NoteName;
  accidental: Accidental;
  octave: number; // scientific pitch notation; middle C is octave 4
}
```

Required utilities: `pitchToMidi(p): number`, `midiToPitch(midi, keyContext): Pitch` (spelling depends on key), `pitchClass(p): number` (0–11), enharmonic equality, and pretty-print (`"F#4"`, `"Bb3"`).

### Key

```typescript
type Mode = 'major' | 'minor';
interface Key {
  tonic: { name: NoteName; accidental: Accidental };
  mode: Mode;
}
```

Required utilities: `keySignature(key): { sharps: number } | { flats: number }`, `diatonicScale(key): ScaleDegree[]` returning the 7 scale degrees with correct spelling, `scaleDegreeOf(pitch, key): number | null`. Must handle all 30 distinct keys with correct enharmonic spelling (e.g. F♯ major contains E♯, not F natural).

### Interval

```typescript
type IntervalSize = 1|2|3|4|5|6|7|8;
type IntervalQuality = 'perfect'|'major'|'minor'|'augmented'|'diminished';
interface Interval {
  size: IntervalSize;
  quality: IntervalQuality;
  semitones: number;
  direction: 'ascending'|'descending'|'unison';
}
```

Required: `intervalBetween(a: Pitch, b: Pitch): Interval` (spelling-aware).

### Chord

```typescript
type TriadQuality = 'major'|'minor'|'diminished'|'augmented';
type SeventhQuality = 'major7'|'minor7'|'dominant7'|'minorMajor7'
  |'halfDiminished'|'fullyDiminished'|'augmentedMajor7'|'augmented7';
interface Chord {
  root: Pitch;
  quality: TriadQuality | SeventhQuality;
  inversion?: 0|1|2|3;
}
```

Required: `chordTones(chord): Pitch[]` (pitch-classes of root/third/fifth/seventh), `romanNumeralToChord(rn: string, quality, key): Chord` (must handle minor-key Roman numerals correctly — e.g. ii in minor is a diminished/half-diminished chord).

### Duration

```typescript
const TICKS_PER_QUARTER = 480;
type BaseDuration = 'whole'|'half'|'quarter'|'eighth'|'sixteenth'|'thirtySecond';
interface Duration {
  base: BaseDuration;
  dots: 0|1|2;
  tuplet?: { numerator: number; denominator: number };
  ticks: number; // authoritative, derived
}
```

Required: `durationToTicks(d): number` and a constructor that computes `ticks` from base+dots+tuplet. Verify: dotted quarter = 720 ticks, triplet eighth = 160 ticks, sixteenth = 120 ticks.

### TimeSignature

```typescript
interface TimeSignature {
  beats: number;
  beatUnit: number;
  strongBeats: number[]; // tick positions within a bar where strong beats fall
}
```

Pre-define 4/4 (strong beats at ticks 0, 960), 3/4 (tick 0), 6/8 (ticks 0, 720). `ticksPerBar(ts): number`.

### NeckPosition

```typescript
interface NeckPosition {
  stringRange: { low: number; high: number }; // 1 = low E, 6 = high E
  fretRange: { low: number; high: number };   // 0 = open
  label?: string; // display only, e.g. 'V'
}
```

### LineNote and Line

```typescript
type ChordToneRole = 'root'|'third'|'fifth'|'seventh'
  |'passing'|'neighbor'|'appoggiatura'|'escape'|'chromatic'
  |'chordTone'|'nonChordTone';

interface LineNote {
  pitch: Pitch | null; // null = rest
  duration: Duration;
  startTick: number;        // absolute from line start
  barIndex: number;
  beatPositionInBar: number;
  isStrongBeat: boolean;
  impliedChord: Chord;
  chordToneRole: ChordToneRole;
  tiedToNext: boolean;
}

interface Line {
  id: string; // UUID
  seed: number;
  generatedAt: string; // ISO
  key: Key;
  timeSignature: TimeSignature;
  position: NeckPosition;
  tempo: number;
  barCount: number;
  progression: ConcreteProgression;
  phraseStructure: PhraseStructure;
  contourTarget: ContourTarget;
  rhythmicMotifPlan: RhythmicMotifPlan;
  notes: LineNote[];
  generatorVersion: string;
  validationsPassed: string[];
}
```

All types must be `JSON.stringify`-able and round-trip safely (this matters for persistence and for Swift `Codable` transfer later).

---

## 7. Fretboard model specification

Standard tuning, strings low-to-high E A D G B E, mapped to MIDI 40, 45, 50, 55, 59, 64. Recall string 1 = low E (MIDI 40), string 6 = high E (MIDI 64).

Build a model that, for each string and fret (0–17), gives the produced pitch. Then:

```typescript
function computePlayablePitches(
  position: NeckPosition,
  stringSubset?: number[]
): { pitch: Pitch; stringFretOptions: {string: number; fret: number}[] }[]
```

Returns the set of distinct pitches playable within the position's fret range on the allowed strings, each annotated with the string/fret combinations that produce it. Spelling of the returned pitches should be resolved against key context at the point of use, not here (return pitch-class info sufficient for the caller to spell).

```typescript
function isPlayableInPosition(pitch, position, stringSubset?): boolean
```

---

## 8. Content library specification

Author a **minimal valid starter set** as JSON. The musical quality and breadth are the human's job to refine; your job is to produce enough valid content that the generator runs end-to-end and the pipeline can be exercised. Clearly mark these as placeholder content in a header comment or a `_meta` field.

### progressions.json

```typescript
interface ProgressionEntry {
  id: string;
  name: string;
  difficulty: 1|2|3|4|5;
  barCount: number;
  chords: {
    romanNumeral: string;   // 'ii', 'V7', 'I' — key-agnostic
    quality: TriadQuality | SeventhQuality;
    barIndex: number;
    startTick: number;      // 0 = downbeat of that bar
  }[];
  tags: string[];           // 'diatonic','secondary-dominant','jazz','modal', etc.
  applicableKeys: 'all' | string[];
}
```

Starter set: author at least 12 progressions covering 2-bar and 4-bar lengths, difficulties 1–3, all-diatonic and basic functional harmony. Examples to include: I–IV–V–I, I–vi–IV–V, ii–V–I, I–V–vi–IV, a 4-bar blues fragment, a I–vi–ii–V turnaround. Roman numerals must be interpreted correctly for both major and minor keys.

### motifs.json

```typescript
interface RhythmicMotifEntry {
  id: string;
  name: string;
  timeSignature: string;    // '4/4', etc.
  difficulty: 1|2|3|4|5;
  durations: Duration[];    // sum must equal one bar of the time signature
  rhythmVocabulary: string[]; // 'syncopated','dotted','triplet', etc.
}
```

Starter set: at least 15 one-bar motifs in 4/4 covering straight quarters, straight eighths, dotted-quarter+eighth, the Charleston figure (dotted quarter, eighth, half), eighth-note syncopations, a triplet bar, and a sixteenth-note grouping. Each motif's durations must sum to exactly `ticksPerBar`. Validate this at load time and fail loudly if violated.

### cadences.json

```typescript
interface CadencePatternEntry {
  id: string;
  name: string;
  harmonicMovement: { from: string; to: string }; // roman numerals
  melodicResolution: {
    from: 'tonic'|'supertonic'|'leadingTone'|'mediant'|'submediant'|'dominant'|'subdominant';
    to: 'tonic'|'mediant'|'dominant';
    motion: 'stepUp'|'stepDown'|'leap';
  };
  constrainsPenultimate: boolean;
  difficulty: 1|2|3|4|5;
}
```

Starter set: authentic cadence (V→I, leadingTone→tonic, stepUp), authentic via supertonic (V→I, supertonic→tonic, stepDown), half cadence (any→V), plagal (IV→I, submediant→dominant... or appropriate). At least 4 entries.

### fallbackLines.json

A small set of pre-authored "safe" complete lines (as serialized `Line` objects or a simplified form) used when generation fails all retries. At least one per a few common configs. These should be boring but correct. Generate these programmatically from a known-good simple config if hand-authoring is impractical, but they must always validate.

### Loading & validation

All libraries are loaded and validated at startup. Validation includes: motif durations sum to a bar, progression bar indices are within range, Roman numerals are parseable, referenced enums are valid. Fail loudly (throw) on invalid content — silent acceptance of bad content is the worst outcome.

---

## 9. Generator pipeline specification

Implement as a sequence of pure functions orchestrated by `generateLine(config, seed)`. The PRNG is seeded once per line from `seed` and threaded through all stages. Every stochastic choice draws from this PRNG — no `Math.random()`.

```typescript
function generateLine(config: LineConfig, seed: number): Line
```

### Stages (in order)

1. **buildGenerationContext(config)** → playable pitches (labeled diatonic/chromatic with scale degree), diatonic scale, strong-beat tick positions, tonic & dominant pitches within range. Filter playable pitches by `accidentalsDensity`.

2. **selectProgression(config, context, rng)** → filter library by barCount, difficulty compatibility, key applicability; sample uniformly (stateless); instantiate Roman numerals into concrete chords in the user's key with correct enharmonic spelling.

3. **selectCadence(key, progression, rng)** → choose a cadence pattern compatible with the progression's final chords. (Selected early because it constrains the final notes.)

4. **selectPhraseStructure(barCount, progression, rng)** → choose AAAB / ABAB / ABAC / throughComposed compatible with barCount; weight by alignment with the progression's harmonic arc.

5. **planRhythm(config, phraseStructure, rng)** → select motif(s) by role; apply per-bar according to phrase structure; apply occasional subtle variations (displacement, augmentation, omission); flatten to a list of note positions with tick offsets. A bar's rhythm must exactly fill the bar.

6. **selectContour(barCount, progression, context, rng)** → choose shape (arch/invertedArch/ascending/descending/steady), climax bar, climax pitch within upper playable range; produce per-bar pitch targets.

7. **placeStrongBeatPitches(progression, rhythm, contour, cadence, context, rng)** → place the final (cadence-constrained) pitch first, then penultimate if constrained, then remaining strong beats in order. Each non-constrained strong beat samples a chord tone weighted by: proximity to bar's contour target, voice-leading from previous strong beat (favor stepwise), chord-tone quality, variety penalty for repetition, climax-bar boost. Use a weighted sampler with a tunable temperature constant.

8. **fillWeakBeatPitches(strongBeats, rhythm, progression, context, rng)** → for each weak beat between two strong beats, fill with connecting motion (passing tones for wide gaps, neighbor motion for same-pitch endpoints, arpeggiation for chord-tone endpoints, chromatic passing if allowed by config). Track and maintain a running step/leap balance targeting ~70% step / ~25% small leap / ~5% large leap. Heavily penalize out-of-position pitches.

9. **annotateNotes** → compute for each note: interval from previous, chordToneRole, isStrongBeat, barIndex, beatPositionInBar.

10. **validatePosition / validateCadence / validateMusicality** → throw `ValidationError` on failure (recoverable; triggers retry). Musicality checks: step/leap balance within tolerance, no more than 3 repeated identical pitches in a row (unless motivic), total range reasonable (≤ ~1.5 octaves typical), contour roughly realized (climax in the planned bar, overall shape recognizable).

### Outer loop

```typescript
const MAX_OUTER_ATTEMPTS = 10;
```

Run the full pipeline; on `ValidationError`, retry from the top with the same seed-derived RNG advanced (so retries differ). After `MAX_OUTER_ATTEMPTS`, log a warning and return a fallback line from `fallbackLines.json`. Record generation telemetry (attempts used, which validator failed) — expose this via the CLI for tuning.

### Tuning constants

All scoring weights, sampling temperature, and validation thresholds must be defined as named constants in one clearly-marked location (e.g. `generator/tuning.ts`) so the human can adjust them without hunting through logic. Document each constant's effect in a comment.

---

## 10. MusicXML serialization specification

Implement `serializeLineToMusicXML(line: Line): string`. Support only the subset needed: single part, treble clef (guitar notation reads at written pitch, treble clef, sounding an octave lower — use the standard guitar `<clef-octave-change>-1` convention), one voice, the key signature, the time signature, notes with correct pitch spelling, durations (including dotted and tuplet), ties, and rests.

The output must render correctly in OSMD and in MuseScore (use MuseScore as the human's audition tool). Accidentals must display according to the note's spelling (respect the key signature; show explicit accidentals only where needed).

---

## 11. Persistence schema specification

Implement via migration `001_initial.sql`. Use `better-sqlite3`. The schema below is authoritative and is the single most important artifact to get right, because it transfers directly to the Swift app.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  app_version TEXT NOT NULL,
  config_snapshot TEXT NOT NULL
);
CREATE INDEX idx_sessions_started ON sessions(started_at);

CREATE TABLE line_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  line_index_in_session INTEGER NOT NULL,
  attempt_type TEXT NOT NULL,          -- 'first_read'|'retry_at_tempo'|'retry_slower'
  parent_attempt_id TEXT REFERENCES line_attempts(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  line_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  line_json TEXT NOT NULL,
  musicxml TEXT NOT NULL,
  key_tonic TEXT NOT NULL,
  key_mode TEXT NOT NULL,
  time_signature TEXT NOT NULL,
  position_label TEXT,
  position_fret_low INTEGER NOT NULL,
  position_fret_high INTEGER NOT NULL,
  bar_count INTEGER NOT NULL,
  tempo_configured INTEGER NOT NULL,
  phrase_structure TEXT NOT NULL,
  progression_id TEXT NOT NULL,
  rhythmic_motif_id TEXT NOT NULL,
  pitch_accuracy REAL,
  timing_accuracy REAL,
  total_expected_notes INTEGER NOT NULL,
  total_hits INTEGER,
  total_wrong_pitch INTEGER,
  total_late INTEGER,
  total_missed INTEGER,
  total_extra INTEGER
);
CREATE INDEX idx_attempts_session ON line_attempts(session_id);
CREATE INDEX idx_attempts_key ON line_attempts(key_tonic, key_mode);
CREATE INDEX idx_attempts_position ON line_attempts(position_fret_low, position_fret_high);
CREATE INDEX idx_attempts_type ON line_attempts(attempt_type);
CREATE INDEX idx_attempts_started ON line_attempts(started_at);

CREATE TABLE note_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES line_attempts(id),
  note_index INTEGER NOT NULL,
  expected_midi INTEGER,               -- NULL for 'extra' events
  expected_pitch_name TEXT,
  expected_onset_tick INTEGER,
  expected_onset_ms INTEGER,
  expected_duration_ms INTEGER,
  bar_index INTEGER,
  is_strong_beat INTEGER,              -- 0/1
  implied_chord_root TEXT,
  implied_chord_quality TEXT,
  chord_tone_role TEXT,
  interval_from_previous_semitones INTEGER,
  interval_from_previous_size INTEGER,
  interval_from_previous_direction TEXT,
  detected_midi INTEGER,               -- NULL if missed
  detected_onset_ms INTEGER,
  detected_duration_ms INTEGER,
  classification TEXT NOT NULL         -- 'hit'|'wrong_pitch'|'late'|'missed'|'extra'
);
CREATE INDEX idx_events_attempt ON note_events(attempt_id);
CREATE INDEX idx_events_classification ON note_events(classification);
CREATE INDEX idx_events_expected_pitch ON note_events(expected_midi);
CREATE INDEX idx_events_interval ON note_events(interval_from_previous_semitones);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);
```

Only `first_read` attempts contribute to fluency metrics; enforce this in queries, not schema. Extra notes are stored in `note_events` with null `expected_*` fields.

---

## 12. Audio pipeline specification

The audio pipeline does NOT need to be low-latency or production quality. It needs to be correct enough to validate the UX.

- **Input:** `getUserMedia` with the audio interface selected. Provide a device picker that lists input devices (`enumerateDevices`) and lets the user choose; remember the choice in a local config file.
- **Pitch detection:** run in an `AudioWorkletNode` to keep it off the main thread. Use `pitchy`. Window size ~2048 samples at the device sample rate. Emit detected `(frequency, clarity, timestamp)` events; convert frequency to MIDI; ignore detections below a clarity threshold (tune empirically — guitar through an interface should give high clarity on clean notes).
- **Metronome:** sample-accurate scheduling using the Web Audio clock (schedule clicks ahead of time against `AudioContext.currentTime`; do NOT use `setInterval` for timing). Support count-in (default 2 bars), accented downbeats, and the configured subdivision. The metronome clock is the authoritative musical time source for the cursor.
- **Headphone guidance:** detect output routing if feasible; if playing through speakers, show a soft warning that headphones improve detection accuracy. Non-blocking.

Document measured round-trip latency in `LEARNINGS.md` even though it's not an acceptance criterion — it's useful data for the Swift build.

---

## 13. Notation, cursor, and evaluation specification

### Rendering & cursor

- Render the current line's MusicXML via OSMD.
- Implement a cursor that advances in musical time, driven by the metronome clock (NOT by detected input). Pre-compute a flat list of `(noteIndex, onsetMs, expectedMidi)` from the Line so the cursor logic knows which note is "current" at each moment without re-querying OSMD.
- The cursor must stay tight to the beat. The metronome never waits for the user.

### Real-time feedback (Mode B)

- As the cursor passes each note, color the notehead based on evaluation, with evaluation trailing the cursor by ~100 ms to allow pitch confidence and the timing window.
- Three visual states: **green** (hit), **red** (wrong pitch at the right time), **dim grey** (missed). Use strong, unambiguous colors readable at a distance.
- After a note is evaluated, slightly dim the region behind the cursor to encourage reading ahead.

### Evaluation

- Align detected notes to expected notes by onset time with a tolerance window. The window scales with tempo and subdivision (generous at slow tempo / quarters, tight at fast tempo / sixteenths). Define the scaling formula as a tunable constant.
- Classify each expected note: `hit` (correct pitch within window), `wrong_pitch` (something at the right time, wrong pitch), `late` (correct pitch after window), `missed` (nothing detected), and record `extra` for detected notes with no expected counterpart.
- Compute and store, per attempt:
  - **Pitch accuracy** = (hits + correct-pitch lates) / total expected notes.
  - **Timing accuracy** = hits / total expected notes.
- Timing tolerance is asymmetric-capable (allow tuning more tolerance for late than early); expose as constants.

### Results screen

After the final note: stop the cursor, display the full line with all notes colored, and show pitch accuracy %, timing accuracy %, configured tempo, and a config summary. Three actions in priority order: **Next line** (primary, large, keyboard-shortcut-able), **Retry at tempo** (logged as `retry_at_tempo`, excluded from fluency stats), **Retry slower** (logged as `retry_slower`, excluded from fluency stats).

---

## 14. Build milestones & acceptance criteria

Work these in order. Do not advance past a milestone until its objective acceptance criteria pass. At human review gates, stop and report.

### Milestone 1 — Domain model & fretboard

**Deliverables:** `/src/domain`, `/src/fretboard`, full unit test coverage.

**Objective acceptance criteria:**
- `pitchToMidi` / `midiToPitch` round-trip correctly across the guitar range (MIDI 40–88) with key-aware spelling.
- `diatonicScale` returns correctly-spelled 7-note scales for all 30 keys (include a test asserting F♯ major contains E♯ and B♯ where applicable, G♭ major contains C♭, etc.).
- `romanNumeralToChord('ii', 'minor7', Key(C major))` yields Dm7; in C minor yields the correct minor-key supertonic chord.
- `durationToTicks`: dotted quarter = 720, triplet eighth = 160, sixteenth = 120.
- `computePlayablePitches` for 5th position (frets 4–8), all strings, returns the correct pitch set with valid string/fret options; `isPlayableInPosition` agrees.
- All domain/fretboard tests pass under vitest. No imports of Electron/React/DOM in these modules.

### Milestone 2 — Content libraries & generator (CLI only)

**Deliverables:** `/src/content` with starter JSON + loaders/validators; `/src/generator` full pipeline; `/src/musicxml` serializer; `/src/cli/generateBatch.ts`.

**Objective acceptance criteria:**
- Content loaders validate all starter content; loading invalid content throws.
- `generateLine(config, seed)` is deterministic: same `(config, seed)` always yields an identical `Line`.
- Property test: generate 1,000 lines across varied configs/seeds; assert for every line — all notes playable in the declared position; rhythm of each bar exactly fills the bar; line ends on a cadentially valid pitch; step/leap balance within tolerance; total range ≤ ~1.5 octaves (allow a configurable margin); no validator exceptions escape (fallbacks allowed but counted).
- Fallback rate across the 1,000-line property run is reported and is < 5%.
- `generateBatch.ts` takes a config (CLI args or JSON file) and a count, and writes N MusicXML files to disk plus a telemetry summary (avg attempts/line, fallback count, validator failure breakdown).
- Generated MusicXML opens and renders without error in MuseScore and OSMD.

**HUMAN REVIEW GATE 1 — musicality:** Generate a batch of 30 lines in 2–3 representative configs. Stop and report to the human that batch files are ready for audition at a stated path, with the telemetry summary. The human plays through them and judges musicality. Do not proceed to polish the generator further or self-assess quality; await human feedback and iterate per their notes.

### Milestone 3 — Electron shell, rendering, metronome, cursor

**Deliverables:** Electron app launches; OSMD renders a generated line; metronome with count-in; cursor advancing in musical time. No audio input yet.

**Objective acceptance criteria:**
- App launches and renders a freshly generated line.
- Metronome is sample-accurate: over a 4-bar line at 120 BPM, the cursor reaches the final downbeat within ±20 ms of the expected wall-clock time (measure and log).
- Count-in works (2 bars default) before the cursor starts the line.
- Cursor visually tracks the correct note at each beat (verifiable by logging current note index against expected at each tick).
- "Next line" generates and renders a new line.

**HUMAN REVIEW GATE 2 — read-along feel:** Human plays along (reading only, no input evaluation yet) to confirm the cursor feels tight and the rendered notation is legible. Report ready and await confirmation.

### Milestone 4 — Audio input, pitch detection, evaluation, feedback

**Deliverables:** `/src/audio`, `/src/evaluation`, real-time feedback coloring, results screen.

**Objective acceptance criteria:**
- Device picker lists input devices and the chosen interface can be selected and persisted.
- Pitch detection emits stable MIDI values for clean single notes across the guitar range (test by playing a chromatic scale; log detected vs. expected; report accuracy %). Flag to human if accuracy on clean input is poor enough to need CREPE.
- Given a recorded or live performance, the evaluation classifies every expected note into exactly one of the five categories, and `pitch_accuracy` / `timing_accuracy` compute correctly (unit-test the aligner with synthetic detected-note sequences covering hit/wrong/late/missed/extra cases).
- Real-time coloring appears as the cursor passes each note, trailing ~100 ms; colors match classifications.
- Results screen shows both metrics, configured tempo, and the three actions; retries are logged with the correct `attempt_type`.

**HUMAN REVIEW GATE 3 — feedback UX:** Human runs full lines and evaluates whether the real-time coloring helps or distracts, whether timing tolerance feels fair, and whether the results screen is useful. Report ready; await UX notes; iterate.

### Milestone 5 — Persistence & session loop & basic stats

**Deliverables:** SQLite schema + writes for sessions/attempts/note_events/presets; the session treadmill loop; 1–2 stats views.

**Objective acceptance criteria:**
- Migration creates the schema exactly as specified in section 11.
- A completed line writes one `sessions` row (on session start/end), one `line_attempts` row, and one `note_events` row per expected note (plus extras). Verify counts in a test session.
- Denormalized dimension columns on `line_attempts` match the values inside `line_json`.
- Preset save/load works; `use_count` and `last_used_at` update on use.
- At least two stats views render from queries: (a) pitch and timing accuracy over time, filterable by at least key and position; (b) a missed-note staff heatmap aggregating `note_events` by expected pitch. Verify each view's query returns correct numbers against a seeded test dataset.
- Confirm the full loop is usable for a real practice session end-to-end.

**HUMAN REVIEW GATE 4 — schema validation:** Confirm with the human that the stats they care about are answerable from the schema. This is the gate that validates the single most important transferable artifact. Report which queries back which views and ask whether any desired stat is unsupported by the current schema.

---

## 15. Acceptance criteria summary (objective, run before declaring done)

A single `npm run verify` (or equivalent) should run:
- All vitest unit tests (domain, fretboard, generator property tests, evaluation aligner tests, stats query tests) — all green.
- The 1,000-line generator property run — all invariants hold, fallback rate < 5%, telemetry printed.
- Schema migration applies cleanly to a fresh DB.
- A scripted end-to-end test that: starts a session, generates a line, feeds a synthetic detected-note sequence through evaluation, writes all rows, and asserts row counts and metric values.

The prototype is "objectively complete" when `npm run verify` is green and all five milestones' objective criteria pass. It is "validated" only after the four human review gates have been cleared by the human — those are not yours to sign off.

---

## 16. Engineering conventions

- **Throwaway discipline:** no premature abstraction, no plugin systems, no config frameworks. Solve the concrete problem.
- **Seeded randomness only** in the generator. `Math.random()` is banned in `/src/generator` and `/src/content`. Lint or grep for it as a check.
- **Structured logging** with category prefixes (`[GEN]`, `[AUDIO]`, `[EVAL]`, `[UI]`, `[DB]`). Verbose by default in the prototype.
- **Let it crash** for unexpected errors during development; only `ValidationError` in the generator is caught-and-retried. Don't wrap everything defensively.
- **Commit per milestone** with clear messages. Tag the commit at each human review gate.
- **No `any`** in `/src/domain`, `/src/generator`, `/src/evaluation`, `/src/persistence`. UI may be looser.
- **Pure modules stay pure:** enforce that domain/fretboard/content/generator/musicxml/evaluation never import Electron, React, or DOM APIs.

---

## 17. LEARNINGS.md — the real deliverable

Maintain `LEARNINGS.md` throughout. This is what carries into the Swift rewrite (the code does not). Record:

- Generator tuning discoveries — which weights/thresholds produced good vs. bad output, which validators fired most, what failure modes appeared and how they were fixed.
- Schema adjustments made during the build and why — any column added, removed, or repurposed relative to section 11.
- Audio findings — measured latency, pitch detection accuracy, clarity thresholds that worked, whether CREPE was needed.
- UX findings from the human review gates — timing tolerance calibrations, cursor visual choices, feedback coloring intensity, results-screen pacing.
- Anything that surprised you or that the Swift implementation should know.

At the end, write a short "Recommendations for the Swift build" section summarizing what to keep, what to change, and what to watch out for.

---

## 18. Open items for the human (not blockers)

These were not fully settled in design and the human should weigh in when convenient; proceed with the stated defaults until told otherwise:

- Standard tuning only confirmed? (Assumed yes.)
- Content format JSON confirmed? (Assumed yes.)
- Minimum bar-count / max bar-count bounds (assumed 2–16, default 4).
- Whether the prototype should attempt output-routing detection for the headphone warning, or just always show a one-time tip.

---

*End of build brief.*
