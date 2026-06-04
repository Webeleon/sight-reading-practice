// Generator configuration and the recoverable ValidationError.
//
// LineConfig is the input to generateLine(). It is deliberately flat and JSON-safe
// (it gets snapshotted into the session/preset rows later). The PRNG seed and the
// generatedAt timestamp are NOT part of the config — they are separate injected
// parameters to generateLine() so that determinism is explicit and the system clock
// is never read during generation.
//
// Pure module: no electron/react/DOM, no `any`.

import type { Key, TimeSignature, NeckPosition } from '../domain/index.js';

/** How much chromaticism the line may use. Maps to admission probabilities in
 *  tuning.ts (ACCIDENTAL_ADMIT_PROBABILITY). */
export type AccidentalsDensity = 'none' | 'low' | 'medium' | 'high';

/** Difficulty 1..5, used to filter content (progressions/cadences/motifs) and to bias
 *  rhythmic complexity. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** Everything needed to generate a line EXCEPT the seed and the timestamp (those are
 *  injected separately to keep generation deterministic and clock-free). */
export interface LineConfig {
  key: Key;
  timeSignature: TimeSignature;
  position: NeckPosition;
  tempo: number; // BPM; carried through to the Line, does not affect note choice
  barCount: number; // 2..16, default 4
  difficulty: Difficulty;
  accidentalsDensity: AccidentalsDensity;
}

/** Default bar count when a config omits it (brief section 3). */
export const DEFAULT_BAR_COUNT = 4;
export const MIN_BAR_COUNT = 2;
export const MAX_BAR_COUNT = 16;

/** Recoverable failure thrown by the validators. generateLine catches ONLY this and
 *  retries the whole pipeline with the RNG advanced. Any other error propagates
 *  ("let it crash", brief section 16). `validator` names which check fired, for
 *  telemetry. */
export class ValidationError extends Error {
  readonly validator: string;
  constructor(validator: string, message: string) {
    super(`[GEN] ${validator} failed: ${message}`);
    this.name = 'ValidationError';
    this.validator = validator;
  }
}
