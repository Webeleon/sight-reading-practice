// Stage 4: selectPhraseStructure.
//
// Choose a repetition/contrast template (AAAB / ABAB / ABAC / throughComposed) that is
// compatible with the bar count, weighting by alignment with the progression's harmonic
// arc. The chosen pattern is expanded into a per-bar role array (length === barCount)
// that planRhythm and the pitch placers use to decide which bars should sound alike.
//
// Compatibility rule: the 4-symbol patterns (AAAB/ABAB/ABAC) need barCount divisible by
// the pattern's natural grouping; for arbitrary bar counts we tile / truncate them and
// always offer throughComposed (which fits any length).
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type {
  ConcreteProgression,
  PhrasePattern,
  PhraseStructure,
} from '../domain/index.js';
import type { Rng } from './prng.js';
import { weightedPick } from './prng.js';
import { PHRASE_PATTERN_WEIGHTS } from './tuning.js';

const FOUR_SYMBOL: ReadonlyArray<PhrasePattern> = ['AAAB', 'ABAB', 'ABAC'];

/** The base 4-bar role sequence for a four-symbol pattern. */
function basePattern(pattern: PhrasePattern): string[] {
  switch (pattern) {
    case 'AAAB':
      return ['A', 'A', 'A', 'B'];
    case 'ABAB':
      return ['A', 'B', 'A', 'B'];
    case 'ABAC':
      return ['A', 'B', 'A', 'C'];
    case 'throughComposed':
      return []; // handled separately (every bar distinct)
  }
}

/** Expand a pattern to exactly `barCount` roles. Four-symbol patterns tile their base
 *  sequence and truncate; throughComposed assigns a distinct role per bar. */
function expandRoles(pattern: PhrasePattern, barCount: number): string[] {
  if (pattern === 'throughComposed') {
    const roles: string[] = [];
    for (let i = 0; i < barCount; i++) {
      // A, B, C, ... distinct per bar (wraps past Z, irrelevant for <=16 bars).
      roles.push(String.fromCharCode(65 + (i % 26)));
    }
    return roles;
  }
  const base = basePattern(pattern);
  const roles: string[] = [];
  for (let i = 0; i < barCount; i++) {
    roles.push(base[i % base.length]!);
  }
  return roles;
}

/** Which patterns are sensible for a given bar count. throughComposed always; the
 *  four-symbol patterns when there are at least 3 bars (so repetition is audible). */
function compatiblePatterns(barCount: number): PhrasePattern[] {
  const out: PhrasePattern[] = ['throughComposed'];
  if (barCount >= 3) out.push(...FOUR_SYMBOL);
  return out;
}

/**
 * Select a phrase structure. Weighted by PHRASE_PATTERN_WEIGHTS, with a mild boost to
 * repetition-heavy patterns when the progression itself repeats harmonically (more
 * harmonic repetition -> melodic repetition reads naturally).
 */
export function selectPhraseStructure(
  barCount: number,
  progression: ConcreteProgression,
  rng: Rng,
): PhraseStructure {
  const candidates = compatiblePatterns(barCount);

  // Harmonic-repetition signal: fraction of bars that reuse an earlier bar's chord
  // degree. Higher -> boost AAAB/ABAB (the repetitive templates).
  const repetition = harmonicRepetition(progression, barCount);

  const weights = candidates.map((p) => {
    let w = PHRASE_PATTERN_WEIGHTS[p];
    if ((p === 'AAAB' || p === 'ABAB') && repetition > 0.3) {
      w *= 1.5;
    }
    if (p === 'throughComposed' && repetition > 0.5) {
      w *= 0.6; // a very repetitive harmony rarely wants a through-composed melody
    }
    return w;
  });

  const pattern = candidates[weightedPick(rng, weights)]!;
  return { pattern, barRoles: expandRoles(pattern, barCount) };
}

/** Fraction of bars whose leading chord degree was already seen in an earlier bar. */
function harmonicRepetition(
  progression: ConcreteProgression,
  barCount: number,
): number {
  const firstDegreeByBar = new Map<number, string>();
  for (const c of progression.chords) {
    if (!firstDegreeByBar.has(c.barIndex)) {
      firstDegreeByBar.set(c.barIndex, c.romanNumeral.toLowerCase());
    }
  }
  const seen = new Set<string>();
  let repeats = 0;
  for (let bar = 0; bar < barCount; bar++) {
    const d = firstDegreeByBar.get(bar);
    if (d === undefined) continue;
    if (seen.has(d)) repeats++;
    seen.add(d);
  }
  return barCount > 0 ? repeats / barCount : 0;
}
