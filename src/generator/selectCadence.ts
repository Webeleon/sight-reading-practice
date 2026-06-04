// Stage 3: selectCadence.
//
// Choose a cadence pattern compatible with the progression's final harmonic movement.
// Selected early because it constrains the LAST (and optionally penultimate) note, which
// the strong-beat placer fixes before anything else.
//
// "Compatible" = the cadence's harmonic movement (from -> to Roman numerals) matches the
// progression's last two chords' degrees (by scale degree, case-insensitively). If
// nothing matches we fall back to any cadence that ends on the same final degree, and
// finally to a uniform pick — a cadence is always returned so the ending is constrained.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { ConcreteProgression } from '../domain/index.js';
import type { CadencePatternEntry } from '../content/cadenceLibrary.js';
import type { Rng } from './prng.js';
import { pick } from './prng.js';

/** Reduce a Roman numeral to its lowercase degree letters (strip quality markers),
 *  so 'V7' and 'v' and 'V' all compare equal as degree 5. */
function degreeLetters(rn: string): string {
  const m = rn.match(/^[ivxIVX]+/);
  return (m ? m[0] : rn).toLowerCase();
}

/** The progression's final and penultimate chord Roman numerals (degree letters). */
function finalMovement(progression: ConcreteProgression): {
  penultimate: string | null;
  final: string;
} {
  const chords = progression.chords;
  const final = degreeLetters(chords[chords.length - 1]!.romanNumeral);
  const penultimate =
    chords.length >= 2
      ? degreeLetters(chords[chords.length - 2]!.romanNumeral)
      : null;
  return { penultimate, final };
}

/**
 * Select a cadence pattern. Prefers an exact harmonic match (from->to equals the
 * progression's penultimate->final degrees), then a match on the final degree only,
 * then any cadence. Always returns one.
 */
export function selectCadence(
  cadences: ReadonlyArray<CadencePatternEntry>,
  progression: ConcreteProgression,
  rng: Rng,
): CadencePatternEntry {
  if (cadences.length === 0) {
    throw new Error('[GEN] cadence library is empty');
  }
  const { penultimate, final } = finalMovement(progression);

  // 1. Exact movement match.
  const exact = cadences.filter(
    (c) =>
      degreeLetters(c.harmonicMovement.to) === final &&
      (penultimate === null ||
        degreeLetters(c.harmonicMovement.from) === penultimate),
  );
  if (exact.length > 0) return pick(rng, exact);

  // 2. Match the final degree only (the most important constraint for the last note).
  const finalMatch = cadences.filter(
    (c) => degreeLetters(c.harmonicMovement.to) === final,
  );
  if (finalMatch.length > 0) return pick(rng, finalMatch);

  // 3. Anything (still constrains the ending to a recognizable cadence).
  return pick(rng, cadences);
}
