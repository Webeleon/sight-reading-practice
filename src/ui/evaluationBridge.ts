// evaluationBridge.ts — glue between the (impure) UI/audio layer and the (pure)
// evaluation pipeline.
//
// Disposable UI layer. This is where the UI does the "build plain data, then call
// the pure evaluator" step the evaluation contract asks for: it derives
// ExpectedNote[] from the Line + the precomputed schedule (rests filtered out)
// and the Subdivision from the line's finest note value, and offers a
// SYNTHETIC-TAKE generator so the whole evaluation + feedback + results path is
// exercisable WITHOUT a guitar (Human Review Gate 3 is the only thing that needs
// real hardware).

import type { Line } from '../domain/index.js';
import { TICKS_PER_QUARTER } from '../domain/index.js';
import {
  precomputeSchedule,
  type Schedule,
} from '../audio/index.js';
import type {
  ExpectedNote,
  DetectedNote,
  Subdivision,
} from '../evaluation/index.js';
import { toleranceWindow } from '../evaluation/index.js';

/**
 * Build the rest-filtered ExpectedNote[] for a Line at its tempo + count-in. Each
 * ExpectedNote.onsetMs is on the schedule clock (t=0 == first count-in click),
 * the SAME clock the audio layer timestamps detections on, so onset alignment is
 * meaningful. noteIndex joins back to line.notes for results highlighting.
 */
export function buildExpectedNotes(
  line: Line,
  countInBars: number,
): { expected: ExpectedNote[]; schedule: Schedule } {
  const schedule = precomputeSchedule(line, line.tempo, countInBars);
  const expected: ExpectedNote[] = [];
  for (const entry of schedule.entries) {
    if (entry.expectedMidi === null) continue; // skip rests
    expected.push({
      noteIndex: entry.noteIndex,
      expectedMidi: entry.expectedMidi,
      onsetMs: entry.onsetMs,
      durationMs: entry.durationMs,
    });
  }
  return { expected, schedule };
}

/**
 * Derive the evaluation Subdivision (the finest rhythmic grid the reader must
 * hit) from the Line's notes. We inspect each note's tick value relative to a
 * quarter: the SHORTEST note present sets the grid. Triplets are detected via the
 * tuplet flag on the duration. This drives the tolerance band's tightness
 * (evaluation/tuning.ts), so a sixteenth-heavy line is judged on a tighter grid
 * than a quarter-note line.
 */
export function deriveSubdivision(line: Line): Subdivision {
  let hasTriplet = false;
  let minTicks = TICKS_PER_QUARTER; // default: a quarter-note grid
  for (const note of line.notes) {
    const d = note.duration;
    if (d.tuplet) hasTriplet = true;
    if (d.ticks > 0 && d.ticks < minTicks) minTicks = d.ticks;
  }
  // Triplets present and finer than eighths -> triplet grid.
  if (hasTriplet) return 'triplet';
  if (minTicks <= TICKS_PER_QUARTER / 4) return 'sixteenth';
  if (minTicks <= TICKS_PER_QUARTER / 2) return 'eighth';
  return 'quarter';
}

/** Knobs for the synthetic-take generator (hardware-free testing of the path). */
export interface SyntheticTakeOptions {
  /** Fraction (0..1) of expected notes to play correctly (pitch + time). 1 = a
   *  flawless take; lower values randomly degrade notes to exercise the other
   *  classifications (wrong_pitch / late / missed) and the results colours. */
  accuracy?: number;
  /** Constant timing offset in ms applied to every detection (positive = late).
   *  Lets the human eyeball how the asymmetric timing band feels. */
  timingBiasMs?: number;
  /** Random timing jitter half-width in ms (uniform +-jitter) per note. */
  timingJitterMs?: number;
  /** Add this many spurious EXTRA detections (no expected counterpart). */
  extraNotes?: number;
  /** Seeded RNG in [0,1) for reproducible takes; defaults to Math.random. */
  rng?: () => number;
}

/**
 * Produce a SYNTHETIC DetectedNote[] from a Line as if a player had read it,
 * with tunable accuracy/timing so the evaluation + feedback + results UI can be
 * driven without a guitar. A perfect take (accuracy=1, no bias/jitter/extras)
 * yields one in-time, correct-pitch detection per expected note -> all hits.
 */
export function synthesizeTake(
  line: Line,
  countInBars: number,
  options: SyntheticTakeOptions = {},
): DetectedNote[] {
  const {
    accuracy = 1,
    timingBiasMs = 0,
    timingJitterMs = 0,
    extraNotes = 0,
    rng = Math.random,
  } = options;

  const { expected } = buildExpectedNotes(line, countInBars);
  const out: DetectedNote[] = [];

  for (const e of expected) {
    const roll = rng();
    if (roll > accuracy) {
      // Degrade this note. Split the failure modes roughly evenly:
      //   - drop it entirely (missed),
      //   - wrong pitch (in time),
      //   - very late (out of band).
      const mode = rng();
      if (mode < 0.34) {
        continue; // missed: no detection at all
      } else if (mode < 0.67) {
        out.push({
          midi: e.expectedMidi + (rng() < 0.5 ? 1 : 2), // a step off
          onsetMs: e.onsetMs + timingBiasMs,
          clarity: 0.9,
        });
      } else {
        out.push({
          midi: e.expectedMidi,
          onsetMs: e.onsetMs + 500, // clearly late -> 'late'
          clarity: 0.9,
        });
      }
      continue;
    }
    const jitter = timingJitterMs > 0 ? (rng() * 2 - 1) * timingJitterMs : 0;
    out.push({
      midi: e.expectedMidi,
      onsetMs: e.onsetMs + timingBiasMs + jitter,
      clarity: 0.95,
    });
  }

  // Spurious extras: drop random pitches at random times within the line span.
  if (extraNotes > 0 && expected.length > 0) {
    const first = expected[0]!.onsetMs;
    const last = expected[expected.length - 1]!.onsetMs;
    const span = Math.max(1, last - first);
    for (let i = 0; i < extraNotes; i++) {
      out.push({
        midi: 50 + Math.floor(rng() * 20),
        onsetMs: first + rng() * span,
        clarity: 0.9,
      });
    }
  }

  out.sort((a, b) => a.onsetMs - b.onsetMs);
  return out;
}

// ---------------------------------------------------------------------------
// DETERMINISTIC named takes — the two explicit Gate-3-preview buttons the brief
// (Milestone 4 synthetic-take harness) asks for. Unlike the random `accuracy`
// slider above, these produce a FIXED, reproducible outcome every run so the
// human (and tests) can eyeball EXACTLY one of each classification colour.
// ---------------------------------------------------------------------------

/**
 * A flawless take: exactly one in-time, correct-pitch detection per expected
 * note. Feeding this through evaluateAttempt yields all `hit`s and 100% on both
 * metrics. This is the "Simulate perfect take" button.
 */
export function synthesizePerfectTake(
  line: Line,
  countInBars: number,
): DetectedNote[] {
  const { expected } = buildExpectedNotes(line, countInBars);
  return expected.map((e) => ({
    midi: e.expectedMidi,
    onsetMs: e.onsetMs,
    clarity: 0.95,
  }));
}

/**
 * The fixed error mix the brief names for the "Simulate take with errors"
 * button: a couple of wrong-pitch notes, one late note, one missed note, and one
 * spurious extra — everything else played correctly. Deterministic (no RNG): the
 * SAME notes are degraded every run, so the resulting colours/metrics are
 * predictable and the human can verify each classification renders correctly.
 *
 * The injected mix (by position among the expected notes, clamped to whatever the
 * current line provides):
 *   - notes 0 and 1   -> wrong pitch (a step sharp), in time   => `wrong_pitch` x2
 *   - note 2          -> right pitch but clearly late          => `late`
 *   - note 3          -> dropped entirely                      => `missed`
 *   - one stray pitch near the first onset                     => `extra`
 *   - all remaining   -> correct pitch, in time                => `hit`
 *
 * On a very short line (fewer than 4 expected notes) the mix degrades gracefully:
 * each rule only fires if its target index exists, so the categories present
 * depend on the line length but never crash.
 */
export function synthesizeKnownErrorTake(
  line: Line,
  countInBars: number,
): DetectedNote[] {
  const { expected } = buildExpectedNotes(line, countInBars);
  const WRONG_PITCH_INDICES = new Set([0, 1]); // a couple of wrong-pitch
  const LATE_INDEX = 2; // one late
  const MISSED_INDEX = 3; // one missed
  const WRONG_PITCH_STEP = 1; // a semitone off -> `wrong_pitch`
  // The `late` detection must land PAST the in-band late bound but INSIDE the
  // aligner's search horizon (3*W), else it would be dropped as an extra and the
  // expected note would read `missed`. We derive it from the SAME tolerance
  // window evaluation uses (line's tempo + subdivision) so the mix is robust at
  // any tempo/grid: lateMs (=1.4*W) + one more symmetric W (=2.4*W < 3*W).
  const win = toleranceWindow(line.tempo, deriveSubdivision(line));
  const LATE_OFFSET_MS = win.lateMs + win.symmetricMs;

  const out: DetectedNote[] = [];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    if (i === MISSED_INDEX) continue; // dropped: no detection at all
    if (WRONG_PITCH_INDICES.has(i)) {
      out.push({ midi: e.expectedMidi + WRONG_PITCH_STEP, onsetMs: e.onsetMs, clarity: 0.9 });
      continue;
    }
    if (i === LATE_INDEX) {
      out.push({ midi: e.expectedMidi, onsetMs: e.onsetMs + LATE_OFFSET_MS, clarity: 0.9 });
      continue;
    }
    out.push({ midi: e.expectedMidi, onsetMs: e.onsetMs, clarity: 0.95 });
  }

  // One spurious EXTRA detection: a pitch with no expected counterpart, dropped
  // between the first two onsets (so it can't be greedily claimed by a real note).
  if (expected.length > 0) {
    const base = expected[0]!;
    const gap =
      expected.length > 1 ? (expected[1]!.onsetMs - base.onsetMs) / 2 : 250;
    out.push({
      midi: base.expectedMidi + 7, // a clearly different pitch (a fifth up)
      onsetMs: base.onsetMs + Math.max(180, gap),
      clarity: 0.9,
    });
  }

  out.sort((a, b) => a.onsetMs - b.onsetMs);
  return out;
}
