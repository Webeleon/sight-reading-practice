// Interval: spelling-aware. The diatonic SIZE comes from the letter distance
// (C->E is always a third, however accidentaled), and the QUALITY comes from how
// the actual semitone count compares to the perfect/major reference for that size.
// This is why C-F# is an augmented fourth but C-Gb is a diminished fifth even
// though both span 6 semitones.

import type { Pitch, NoteName } from './pitch.js';
import { pitchToMidi } from './pitch.js';

export type IntervalSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type IntervalQuality =
  | 'perfect'
  | 'major'
  | 'minor'
  | 'augmented'
  | 'diminished';

export interface Interval {
  size: IntervalSize;
  quality: IntervalQuality;
  semitones: number;
  direction: 'ascending' | 'descending' | 'unison';
}

const LETTERS: ReadonlyArray<NoteName> = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// "Diatonic step number" of a pitch: a monotonic count of letters across octaves,
// so the letter distance between two pitches gives the interval size directly.
function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + LETTERS.indexOf(p.name);
}

// Sizes 1,4,5,8 are "perfect" family; 2,3,6,7 are "major/minor" family.
const PERFECT_SIZES: ReadonlySet<number> = new Set([1, 4, 5, 8]);

// Reference semitone count for a PERFECT interval of each simple size (1..8),
// and for a MAJOR interval of each major/minor-family size.
const PERFECT_SEMITONES: Readonly<Record<number, number>> = {
  1: 0,
  4: 5,
  5: 7,
  8: 12,
};
const MAJOR_SEMITONES: Readonly<Record<number, number>> = {
  2: 2,
  3: 4,
  6: 9,
  7: 11,
};

/**
 * Interval from `a` to `b`, spelling-aware. Size is reduced to a simple interval
 * (1-8), with a span of exactly one octave reported as size 8.
 */
export function intervalBetween(a: Pitch, b: Pitch): Interval {
  const midiA = pitchToMidi(a);
  const midiB = pitchToMidi(b);

  const direction: Interval['direction'] =
    midiA === midiB ? 'unison' : midiA < midiB ? 'ascending' : 'descending';

  // Work from the lower to the higher pitch so size/quality are well-defined.
  const [low, high] = midiA <= midiB ? [a, b] : [b, a];

  const letterSpan = diatonicIndex(high) - diatonicIndex(low); // >= 0
  const semitones = Math.abs(midiB - midiA);

  // Simple size: letterSpan 0 -> unison(1), 1 -> 2nd, ... 7 -> octave(8).
  // Reduce compound spans to within an octave, but keep an exact octave as 8.
  let simpleSpan = letterSpan % 7;
  if (letterSpan > 0 && simpleSpan === 0) {
    simpleSpan = 7; // exact octave (or multiple) -> treat as octave
  }
  const size = (simpleSpan + 1) as IntervalSize;

  // Reduce semitones to within an octave to compare against the reference,
  // again keeping an exact octave as 12 for size 8.
  let simpleSemitones = semitones % 12;
  if (size === 8) {
    simpleSemitones = 12;
  }

  const quality = qualityFor(size, simpleSemitones);

  return { size, quality, semitones, direction };
}

function qualityFor(size: IntervalSize, semitones: number): IntervalQuality {
  if (PERFECT_SIZES.has(size)) {
    const ref = PERFECT_SEMITONES[size]!;
    const diff = semitones - ref;
    if (diff === 0) return 'perfect';
    if (diff === 1) return 'augmented';
    if (diff === -1) return 'diminished';
    // Larger deviations are double-augmented/diminished; clamp to the nearest
    // single — the generator never produces these, so this is a defensive label.
    return diff > 0 ? 'augmented' : 'diminished';
  }
  const ref = MAJOR_SEMITONES[size]!;
  const diff = semitones - ref;
  if (diff === 0) return 'major';
  if (diff === -1) return 'minor';
  if (diff === 1) return 'augmented';
  if (diff === -2) return 'diminished';
  return diff > 0 ? 'augmented' : 'diminished';
}
