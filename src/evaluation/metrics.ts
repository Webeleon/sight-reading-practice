// evaluation/metrics.ts — roll a per-note classification list up into the
// per-attempt EvaluationResult (counts + the two accuracy metrics).
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`.
//
// Metric definitions (brief section 13):
//   pitch_accuracy  = (hits + correct-pitch lates) / total expected notes
//   timing_accuracy = hits / total expected notes
//
// Every NON-extra NoteResult corresponds to exactly one expected note, so
// hits + wrongPitch + late + missed === totalExpectedNotes. `late` rows are, by
// construction in classify.ts, always correct-pitch, so the pitch-accuracy
// numerator is simply hits + late. Extras don't enter either denominator.

import type {
  DetectedNote,
  ExpectedNote,
  EvaluationParams,
  EvaluationResult,
  NoteResult,
} from './types.js';
import { classifyNotes } from './classify.js';

/** Aggregate a per-note classification list into the per-attempt summary.
 *  Exposed separately so callers/tests can summarise a hand-built NoteResult[]
 *  without re-running alignment. */
export function summarize(notes: NoteResult[]): EvaluationResult {
  let hits = 0;
  let wrongPitch = 0;
  let late = 0;
  let missed = 0;
  let extra = 0;

  for (const n of notes) {
    switch (n.classification) {
      case 'hit':
        hits++;
        break;
      case 'wrong_pitch':
        wrongPitch++;
        break;
      case 'late':
        late++;
        break;
      case 'missed':
        missed++;
        break;
      case 'extra':
        extra++;
        break;
    }
  }

  const totalExpectedNotes = hits + wrongPitch + late + missed;
  // Guard against a zero-note line: define accuracies as 0 rather than NaN.
  const pitchAccuracy =
    totalExpectedNotes === 0 ? 0 : (hits + late) / totalExpectedNotes;
  const timingAccuracy = totalExpectedNotes === 0 ? 0 : hits / totalExpectedNotes;

  return {
    totalExpectedNotes,
    hits,
    wrongPitch,
    late,
    missed,
    extra,
    pitchAccuracy,
    timingAccuracy,
    notes,
  };
}

/**
 * Full evaluation in one call: align + classify + summarise. This is the public
 * entry point the audio/UI layer uses per attempt.
 *
 * @param expected  rest-filtered expected notes (with onsets precomputed by the
 *                  caller from the schedule).
 * @param detected  raw detections from the pitch detector.
 * @param params    tempo + subdivision (drive the tolerance band).
 */
export function evaluateAttempt(
  expected: ExpectedNote[],
  detected: DetectedNote[],
  params: EvaluationParams,
): EvaluationResult {
  const notes = classifyNotes(expected, detected, params);
  return summarize(notes);
}
