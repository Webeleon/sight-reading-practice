// Barrel for the generator pipeline. Pure logic; depends on domain, fretboard, content.
// Type-only symbols are re-exported with `export type` (verbatimModuleSyntax).

// --- config & errors ---
export type {
  LineConfig,
  AccidentalsDensity,
  Difficulty,
} from './config.js';
export {
  ValidationError,
  DEFAULT_BAR_COUNT,
  MIN_BAR_COUNT,
  MAX_BAR_COUNT,
} from './config.js';

// --- prng ---
export type { Rng } from './prng.js';
export { makeRng, randInt, pick, weightedPick, softmaxPick } from './prng.js';

// --- context ---
export type { GenerationContext, PlayableNote } from './context.js';
export { buildGenerationContext, nearestPlayable, midiOf } from './context.js';

// --- stages ---
export {
  selectProgression,
  candidateProgressions,
  chordAt,
} from './selectProgression.js';
export { selectCadence } from './selectCadence.js';
export { selectPhraseStructure } from './selectPhraseStructure.js';
export { planRhythm } from './planRhythm.js';
export type { RhythmPlan } from './planRhythm.js';
export { selectContour } from './selectContour.js';
export { placeStrongBeatPitches } from './placeStrongBeats.js';
export type { StrongBeatPitches } from './placeStrongBeats.js';
export { fillWeakBeatPitches } from './fillWeakBeats.js';
export { annotateNotes, intervalFromPrevious } from './annotateNotes.js';

// --- types ---
export type { RhythmSlot, PitchedSlot } from './types.js';

// --- validators ---
export {
  validatePosition,
  validateCadence,
  validateMusicality,
} from './validators.js';

// --- orchestrator ---
export type {
  GenerationTelemetry,
  ContentLibraries,
  GenerateOptions,
} from './generateLine.js';
export { generateLine, GENERATOR_VERSION } from './generateLine.js';

// --- fallback ---
export { getFallbackLine, loadFallbackLines } from './fallback.js';

// --- tuning (re-export the whole surface for the CLI/tests) ---
export * from './tuning.js';
