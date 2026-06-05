// Barrel for the PURE evaluation pipeline (Milestone 4). No Web Audio / DOM /
// React / Electron; no `any`. Types and values are re-exported separately because
// verbatimModuleSyntax requires `export type` for type-only symbols.
//
// Pipeline: the audio/UI layer builds ExpectedNote[] (from the Line + the
// precomputed schedule, rests filtered out) and DetectedNote[] (from the pitch
// detector), then calls evaluateAttempt(expected, detected, { tempoBpm,
// subdivision }) to get an EvaluationResult (counts, pitch/timing accuracy, and
// the per-note classification list ready for M5 persistence + the results screen).

// --- tuning (the one place to calibrate evaluation) ---
export type { Subdivision, ToleranceWindow } from './tuning.js';
export {
  BASE_ONSET_TOLERANCE_MS,
  REFERENCE_TEMPO_BPM,
  TEMPO_SCALING_EXPONENT,
  SUBDIVISION_TOLERANCE_FACTOR,
  EARLY_TOLERANCE_FRACTION,
  LATE_TOLERANCE_FRACTION,
  TRAILING_EVALUATION_DELAY_MS,
  PITCH_TOLERANCE_SEMITONES,
  CLARITY_THRESHOLD,
  onsetToleranceMs,
  toleranceWindow,
} from './tuning.js';

// --- data contract ---
export type {
  DetectedNote,
  ExpectedNote,
  Classification,
  NoteResult,
  EvaluationResult,
  EvaluationParams,
} from './types.js';

// --- align ---
export type { Alignment, AlignmentResult } from './align.js';
export { alignNotes, filterByClarity } from './align.js';

// --- classify ---
export { classifyNotes } from './classify.js';

// --- metrics (public entry point) ---
export { evaluateAttempt, summarize } from './metrics.js';
