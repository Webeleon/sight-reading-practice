// Standard guitar tuning, strings low-to-high: E A D G B E.
//
// STRING NUMBERING IS INVERTED from common guitar convention:
//   string 1 = low E  (MIDI 40)
//   string 6 = high E  (MIDI 64)
// Index into OPEN_STRING_MIDI with (stringNumber - 1).
//
// These are the MIDI numbers of each OPEN string (fret 0). Fretting up adds 1
// semitone (= +1 MIDI) per fret.

/** Open-string MIDI by string number, string 1 (low E) first. */
export const OPEN_STRING_MIDI: ReadonlyArray<number> = [40, 45, 50, 55, 59, 64];

/** The valid string numbers, 1 (low E) through 6 (high E). */
export const STRING_NUMBERS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6];

/**
 * MIDI number of an open string.
 * @param stringNumber 1 = low E (MIDI 40) ... 6 = high E (MIDI 64). INVERTED convention.
 */
export function openStringMidi(stringNumber: number): number {
  const midi = OPEN_STRING_MIDI[stringNumber - 1];
  if (midi === undefined) {
    throw new Error(`invalid string number ${stringNumber}; expected 1..6`);
  }
  return midi;
}
