// Duration in ticks. 480 ticks per quarter note (MIDI/MusicXML standard).
// `ticks` is the authoritative, derived value; base+dots+tuplet are the notation.

export const TICKS_PER_QUARTER = 480;

export type BaseDuration =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirtySecond';

export interface Tuplet {
  numerator: number; // how many notes are played
  denominator: number; // in the time of this many normal notes
}

export interface Duration {
  base: BaseDuration;
  dots: 0 | 1 | 2;
  tuplet?: Tuplet;
  ticks: number; // authoritative, derived from base+dots+tuplet
}

// Base durations as a multiple of a quarter note, then scaled by TICKS_PER_QUARTER.
const BASE_TICKS: Readonly<Record<BaseDuration, number>> = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
  thirtySecond: TICKS_PER_QUARTER / 8,
};

/** Compute ticks from base, dots, and an optional tuplet ratio. */
export function computeTicks(
  base: BaseDuration,
  dots: 0 | 1 | 2,
  tuplet?: Tuplet,
): number {
  let ticks = BASE_TICKS[base];
  // Each dot adds half of the previous value: 1 dot = x1.5, 2 dots = x1.75.
  if (dots === 1) {
    ticks = ticks + ticks / 2;
  } else if (dots === 2) {
    ticks = ticks + ticks / 2 + ticks / 4;
  }
  // A tuplet plays `numerator` notes in the time of `denominator`: scale by
  // denominator/numerator (e.g. triplet 3:2 -> x2/3).
  if (tuplet) {
    ticks = (ticks * tuplet.denominator) / tuplet.numerator;
  }
  return ticks;
}

/** Construct a Duration, computing its authoritative `ticks`. */
export function makeDuration(
  base: BaseDuration,
  dots: 0 | 1 | 2 = 0,
  tuplet?: Tuplet,
): Duration {
  const ticks = computeTicks(base, dots, tuplet);
  // Omit the tuplet key entirely when absent so JSON round-trips cleanly.
  return tuplet ? { base, dots, tuplet, ticks } : { base, dots, ticks };
}

/** Return the authoritative tick count of a Duration. */
export function durationToTicks(d: Duration): number {
  return d.ticks;
}
