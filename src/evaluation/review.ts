// evaluation/review.ts — PURE delta helpers for the DETECTION-REVIEW feature.
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`. Node-unit-testable.
//
// The review screen (impure UI) needs a per-EXPECTED-note comparison of what the
// app DETECTED vs what was expected, with the pitch error (in CENTS when the
// detected frequency is known, else a whole-semitone difference), the signed
// timing error (+ = late, - = early), the hit/wrong_pitch/late/missed
// classification, and an octave-error flag. This module turns the (already
// computed) EvaluationResult + the raw expected/detected lists into those plain
// rows, plus the leftover EXTRA detections. It is the single pure place the math
// lives so it can be unit-tested without a browser.
//
// Why it takes the EvaluationResult AND the raw lists: the classification +
// onset-pairing already live in NoteResult (we never re-run alignment here, so the
// review always agrees with the results screen), but NoteResult only carries the
// detected MIDI/onset — not the representative FREQUENCY needed for an exact cents
// error. We recover that frequency by matching each detected NoteResult back to
// its source DetectedNote (which may carry an optional freqHz from the segmenter).

import { A4_HZ, A4_MIDI } from './pitchConst.js';
import type {
  DetectedNote,
  ExpectedNote,
  EvaluationResult,
  NoteResult,
  Classification,
} from './types.js';

/**
 * Cents that frequency `freqHz` is sharp (+) / flat (-) of a REFERENCE frequency,
 * by the equal-tempered formula 1200 * log2(freq / reference). 0 when they match.
 * NaN-safe: a non-positive / non-finite input yields NaN (the caller guards).
 */
export function freqToCents(freqHz: number, referenceHz: number): number {
  if (
    !Number.isFinite(freqHz) ||
    !Number.isFinite(referenceHz) ||
    freqHz <= 0 ||
    referenceHz <= 0
  ) {
    return NaN;
  }
  return 1200 * Math.log2(freqHz / referenceHz);
}

/** The frequency (Hz) of an (integer or fractional) MIDI note in equal
 *  temperament against the A4 reference. Pure inverse of the MIDI formula. */
export function midiToFreq(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** One per-EXPECTED-note review row (the detection-review table's row model). */
export interface ReviewRow {
  /** Index into line.notes (joins back to the Line). */
  noteIndex: number;
  classification: Classification;
  /** Expected MIDI pitch. */
  expectedMidi: number;
  /** Detected MIDI pitch, or null when the note was missed. */
  detectedMidi: number | null;
  /** detectedMidi - expectedMidi (signed semitone difference), null when missed.
   *  Always present when there is a detection (works for synthetic takes that
   *  carry only an integer MIDI). */
  pitchErrorSemitones: number | null;
  /** 1200*log2(detFreq/expFreq) — the EXACT cents error — when the detection
   *  carries a representative freqHz (live mode); null when missed OR when only an
   *  integer MIDI is known (synthetic mode, where the semitone diff is the answer). */
  pitchErrorCents: number | null;
  /** Expected onset (ms on the schedule clock). */
  expectedOnsetMs: number;
  /** Detected onset (ms), or null when missed. */
  detectedOnsetMs: number | null;
  /** detectedOnsetMs - expectedOnsetMs (signed: + = late, - = early); null when
   *  missed. */
  timingErrorMs: number | null;
  /** True when the detection is the right pitch class but the WRONG octave
   *  (|detected - expected| is a non-zero multiple of 12 semitones). Surfaced
   *  separately because an octave error is a detector artifact, not a reading
   *  fault. False when missed. */
  isOctaveError: boolean;
}

/** One EXTRA detection (a detected note with no expected counterpart). */
export interface ReviewExtra {
  detectedMidi: number;
  detectedOnsetMs: number;
  /** Representative frequency, when known (live mode); null otherwise. */
  detectedFreqHz: number | null;
}

/** The full per-attempt review model: one row per expected note (expected order),
 *  plus the leftover extra detections. */
export interface ReviewModel {
  rows: ReviewRow[];
  extras: ReviewExtra[];
}

/** Whether two MIDI values differ by a non-zero whole number of octaves (±12,
 *  ±24, ...). A pure semitone-difference predicate (no frequency needed). */
export function isOctaveError(expectedMidi: number, detectedMidi: number): boolean {
  const diff = detectedMidi - expectedMidi;
  return diff !== 0 && diff % 12 === 0;
}

/**
 * Recover the representative frequency for a detected NoteResult by matching it
 * back to its source DetectedNote. We match on (midi, onsetMs) — the pair the
 * classifier copied verbatim onto the row — and return the first unused match's
 * freqHz (or null when none carried one, e.g. a synthetic take). A small index of
 * consumed source notes keeps duplicate (midi,onset) detections from all claiming
 * the same source.
 */
function makeFreqLookup(
  detected: ReadonlyArray<DetectedNote>,
): (midi: number, onsetMs: number) => number | null {
  const consumed = new Array<boolean>(detected.length).fill(false);
  return (midi: number, onsetMs: number): number | null => {
    for (let i = 0; i < detected.length; i++) {
      if (consumed[i]) continue;
      const d = detected[i]!;
      if (d.midi === midi && d.onsetMs === onsetMs) {
        consumed[i] = true;
        return d.freqHz !== undefined && Number.isFinite(d.freqHz)
          ? d.freqHz
          : null;
      }
    }
    return null;
  };
}

/**
 * Build the per-note review model from an already-computed EvaluationResult plus
 * the raw expected + detected lists. Pure: it re-uses the result's classification
 * and onset deltas (never re-runs alignment), and only ADDS the pitch-error math
 * (cents when a freqHz is available, else the whole-semitone difference) and the
 * octave-error flag. Rows are in expected order; extras follow in detected order.
 *
 * @param result   the EvaluationResult from evaluateAttempt (its NoteResult[] is
 *                  the source of classification + onset pairing).
 * @param detected the raw detections (the source of optional freqHz per note).
 */
export function buildReviewModel(
  result: EvaluationResult,
  detected: ReadonlyArray<DetectedNote>,
): ReviewModel {
  const freqOf = makeFreqLookup(detected);
  const rows: ReviewRow[] = [];
  const extras: ReviewExtra[] = [];

  for (const n of result.notes) {
    if (n.classification === 'extra') {
      // An extra always has a detection but no expected side.
      const dMidi = n.detectedMidi!;
      const dOnset = n.detectedOnsetMs!;
      extras.push({
        detectedMidi: dMidi,
        detectedOnsetMs: dOnset,
        detectedFreqHz: freqOf(dMidi, dOnset),
      });
      continue;
    }
    rows.push(reviewRowFor(n, freqOf));
  }

  return { rows, extras };
}

/** Build one ReviewRow from a non-extra NoteResult. `freqOf` recovers the
 *  detection's representative frequency for the cents computation. */
function reviewRowFor(
  n: NoteResult,
  freqOf: (midi: number, onsetMs: number) => number | null,
): ReviewRow {
  // Non-extra rows always have an expected side (classify.ts guarantees it).
  const expectedMidi = n.expectedMidi!;
  const expectedOnsetMs = n.expectedOnsetMs!;

  if (n.classification === 'missed') {
    return {
      noteIndex: n.noteIndex!,
      classification: n.classification,
      expectedMidi,
      detectedMidi: null,
      pitchErrorSemitones: null,
      pitchErrorCents: null,
      expectedOnsetMs,
      detectedOnsetMs: null,
      timingErrorMs: null,
      isOctaveError: false,
    };
  }

  const detectedMidi = n.detectedMidi!;
  const detectedOnsetMs = n.detectedOnsetMs!;
  const pitchErrorSemitones = detectedMidi - expectedMidi;
  // Prefer the EXACT cents error from the representative frequency when known;
  // otherwise leave cents null and let the consumer fall back to the semitone diff.
  const detFreq = freqOf(detectedMidi, detectedOnsetMs);
  const pitchErrorCents =
    detFreq !== null ? freqToCents(detFreq, midiToFreq(expectedMidi)) : null;

  return {
    noteIndex: n.noteIndex!,
    classification: n.classification,
    expectedMidi,
    detectedMidi,
    pitchErrorSemitones,
    pitchErrorCents,
    expectedOnsetMs,
    detectedOnsetMs,
    // Signed timing error: + = late, - = early. NoteResult.onsetDeltaMs already
    // carries this for paired rows; recompute defensively so a missing delta
    // (should not happen for hit/wrong_pitch/late) still yields a number.
    timingErrorMs: n.onsetDeltaMs ?? detectedOnsetMs - expectedOnsetMs,
    isOctaveError: isOctaveError(expectedMidi, detectedMidi),
  };
}
