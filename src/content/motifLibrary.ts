// motifLibrary — loads & validates the rhythmic-motif content library.
//
// Pure module (brief s5): no electron/react/DOM. JSON is imported statically via
// `resolveJsonModule` so this works identically under tsc and Vite/vitest, with
// no fs/path I/O. Validation is LOUD: an invalid library throws — silent
// acceptance of bad content is the worst outcome (brief s8).

import type { Duration } from '../domain/index.js';
import { FOUR_FOUR, ticksPerBar, durationToTicks } from '../domain/index.js';
import motifsData from './data/motifs.json' with { type: 'json' };

/** A one-bar rhythmic motif. `durations` MUST sum to one bar of `timeSignature`.
 *  Mirrors brief s8 RhythmicMotifEntry. */
export interface RhythmicMotifEntry {
  id: string;
  name: string;
  timeSignature: string; // e.g. '4/4'
  difficulty: 1 | 2 | 3 | 4 | 5;
  durations: Duration[]; // sum must equal ticksPerBar of timeSignature
  rhythmVocabulary: string[]; // 'syncopated','dotted','triplet', ...
}

/** Thrown when a motif's durations do not exactly fill its bar (or other
 *  structural content errors). Distinct class so callers/tests can assert on it. */
export class MotifValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotifValidationError';
  }
}

// Only 4/4 is needed for the starter set (brief s8); map the few signatures we
// support to their tick-per-bar value. Unknown signatures fail loudly.
function ticksPerBarFor(timeSignature: string): number {
  switch (timeSignature) {
    case '4/4':
      return ticksPerBar(FOUR_FOUR);
    default:
      throw new MotifValidationError(
        `[CONTENT] unsupported motif timeSignature: ${timeSignature}`,
      );
  }
}

/**
 * Validate every motif: durations must sum to exactly one bar of its time
 * signature. Throws MotifValidationError (loudly) on the first violation.
 * Returns the same array for convenient chaining.
 */
export function validateMotifs(
  motifs: RhythmicMotifEntry[],
): RhythmicMotifEntry[] {
  for (const m of motifs) {
    const expected = ticksPerBarFor(m.timeSignature);
    const sum = m.durations.reduce(
      (acc, d) => acc + durationToTicks(d),
      0,
    );
    if (sum !== expected) {
      throw new MotifValidationError(
        `[CONTENT] motif "${m.id}" durations sum to ${sum} ticks but must sum ` +
          `to ${expected} (one ${m.timeSignature} bar)`,
      );
    }
  }
  return motifs;
}

/**
 * Load and validate the rhythmic-motif library from motifs.json.
 * Throws MotifValidationError if any motif does not fill its bar.
 */
export function loadMotifs(): RhythmicMotifEntry[] {
  // NB: no success log here — `console` is not in tsconfig.pure.json's lib (no
  // DOM, no @types/node), so referencing it is a compile error under the pure
  // build. Validation throws LOUDLY on bad content, which is the behavior the
  // brief actually requires at load time.
  const motifs = motifsData.motifs as RhythmicMotifEntry[];
  return validateMotifs(motifs);
}
