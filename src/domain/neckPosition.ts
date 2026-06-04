// NeckPosition: a rectangular region of the fretboard the line must stay within.
//
// STRING NUMBERING IS INVERTED from common guitar convention:
//   string 1 = low E  (MIDI 40)
//   string 6 = high E  (MIDI 64)
// Every function in this codebase that takes a string number follows this rule.
// fretRange.low = 0 means open strings are allowed.

export interface NeckPosition {
  stringRange: { low: number; high: number }; // 1 = low E, 6 = high E
  fretRange: { low: number; high: number }; // 0 = open
  label?: string; // display only, e.g. 'V'
}

/**
 * Build a NeckPosition.
 * @param stringLow  lowest string number in the region (1 = low E)
 * @param stringHigh highest string number in the region (6 = high E)
 * @param fretLow    lowest fret (0 = open)
 * @param fretHigh   highest fret
 * @param label      optional display label, e.g. 'V'
 */
export function makeNeckPosition(
  stringLow: number,
  stringHigh: number,
  fretLow: number,
  fretHigh: number,
  label?: string,
): NeckPosition {
  const base: NeckPosition = {
    stringRange: { low: stringLow, high: stringHigh },
    fretRange: { low: fretLow, high: fretHigh },
  };
  return label === undefined ? base : { ...base, label };
}
