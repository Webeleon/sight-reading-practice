// evaluation/types.ts — the plain-data contract between the (impure) audio/UI
// layers and the (pure) evaluation pipeline.
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`. The audio layer
// feeds evaluation plain records; evaluation never imports musicalTime or any
// impure module. Expected onsets are computed by the caller (via the existing
// precomputeSchedule) and handed in as ExpectedNote[]; this keeps evaluation a
// pure function of plain data and avoids any transitive impure import.

import type { Subdivision } from './tuning.js';

/**
 * One note the pitch detector emitted, projected to plain data. Exactly the
 * shape the audio worklet/UI can produce from a (frequency, clarity, timestamp)
 * event after frequency->MIDI conversion and onset segmentation.
 */
export interface DetectedNote {
  /** Detected MIDI note number (rounded from the detected frequency). */
  midi: number;
  /** Onset time in ms on the SAME clock as ExpectedNote.onsetMs (the schedule's
   *  t=0 == first count-in click). The audio layer is responsible for putting
   *  detections on this clock. */
  onsetMs: number;
  /** Optional sounding duration in ms (detector may not segment offsets). */
  durationMs?: number;
  /** Optional detector confidence 0..1; detections below CLARITY_THRESHOLD are
   *  dropped before alignment. Absent = trusted. */
  clarity?: number;
  /** Optional REPRESENTATIVE fundamental in Hz that produced `midi` (the onset
   *  segmenter populates this from the frames it grouped). Carried purely so the
   *  detection-review layer can compute an exact CENTS pitch error against the
   *  expected note's frequency; evaluation/classification never reads it. Absent
   *  for synthetic takes (only an integer MIDI is known) — the review then falls
   *  back to a semitone difference. */
  freqHz?: number;
}

/**
 * One expected note, derived by the caller from the Line + the precomputed
 * schedule. Rests are NOT expected notes — the caller filters them out before
 * building this list (so every ExpectedNote has a real pitch to match). The
 * `noteIndex` joins back to line.notes for persistence / results highlighting.
 */
export interface ExpectedNote {
  /** Index into line.notes (NOT a dense 0..n index) — joins back to the Line. */
  noteIndex: number;
  /** Expected MIDI pitch. */
  expectedMidi: number;
  /** Expected onset in ms on the schedule clock (== ScheduleEntry.onsetMs). */
  onsetMs: number;
  /** Expected duration in ms (== ScheduleEntry.durationMs). */
  durationMs: number;
}

/** The five mutually-exclusive outcomes for a note (brief section 13). */
export type Classification =
  | 'hit' // correct pitch within the timing band
  | 'wrong_pitch' // a detection at the right time, wrong pitch
  | 'late' // correct pitch but after the band
  | 'missed' // nothing detected for this expected note
  | 'extra'; // a detection with no expected counterpart

/**
 * One row of the per-note result. For real expected notes the `expected*` fields
 * are populated and `noteIndex` joins to line.notes. For an 'extra' event the
 * expected fields are null (matching the persistence schema's nullable
 * `expected_*` columns in section 11) and `noteIndex` is null.
 */
export interface NoteResult {
  /** Index into line.notes, or null for an 'extra' detection. */
  noteIndex: number | null;
  classification: Classification;

  // Expected side (null on 'extra').
  expectedMidi: number | null;
  expectedOnsetMs: number | null;
  expectedDurationMs: number | null;

  // Detected side (null on 'missed').
  detectedMidi: number | null;
  detectedOnsetMs: number | null;
  detectedDurationMs: number | null;

  /** detectedOnsetMs - expectedOnsetMs in ms (positive = late), or null when one
   *  side is absent. Useful for the results screen and timing-bias stats. */
  onsetDeltaMs: number | null;
}

/** Per-attempt summary plus the per-note list (ready for M5 persistence and the
 *  results screen). Counts always satisfy:
 *  hits + wrongPitch + late + missed === totalExpectedNotes, and `extra` is
 *  separate (detections beyond the expected count). */
export interface EvaluationResult {
  totalExpectedNotes: number;
  hits: number;
  wrongPitch: number;
  late: number;
  missed: number;
  extra: number;
  /** (hits + correct-pitch lates) / totalExpectedNotes, in [0,1]. */
  pitchAccuracy: number;
  /** hits / totalExpectedNotes, in [0,1]. */
  timingAccuracy: number;
  /** One row per expected note (in expected order) followed by extra rows (in
   *  detected order). Suitable directly for note_events insertion in M5. */
  notes: NoteResult[];
}

/** Inputs that parameterise alignment/classification for one attempt. */
export interface EvaluationParams {
  tempoBpm: number;
  subdivision: Subdivision;
}
