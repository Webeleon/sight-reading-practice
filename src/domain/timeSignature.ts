// TimeSignature. `strongBeats` are tick positions within a bar where strong beats
// fall (used by the generator to place chord tones). 480 ticks per quarter note.

import { TICKS_PER_QUARTER } from './duration.js';

export interface TimeSignature {
  beats: number;
  beatUnit: number; // denominator: 4 = quarter, 8 = eighth, ...
  strongBeats: number[]; // tick positions within a bar where strong beats fall
}

/** Ticks in one bar = beats * (ticks of one beat-unit note). */
export function ticksPerBar(ts: TimeSignature): number {
  // A beat-unit note is a whole note divided by beatUnit; in ticks that is
  // (TICKS_PER_QUARTER * 4) / beatUnit.
  const ticksPerBeatUnit = (TICKS_PER_QUARTER * 4) / ts.beatUnit;
  return ts.beats * ticksPerBeatUnit;
}

/** Build an arbitrary time signature. */
export function makeTimeSignature(
  beats: number,
  beatUnit: number,
  strongBeats: number[],
): TimeSignature {
  return { beats, beatUnit, strongBeats };
}

// Predefined common signatures with their strong-beat tick maps.
// 4/4: downbeat at 0, secondary strong beat at beat 3 = tick 960.
export const FOUR_FOUR: TimeSignature = makeTimeSignature(4, 4, [0, 960]);
// 3/4: single strong beat on the downbeat.
export const THREE_FOUR: TimeSignature = makeTimeSignature(3, 4, [0]);
// 6/8: two dotted-quarter groups; strong beats at 0 and 720 (= 1.5 quarters).
export const SIX_EIGHT: TimeSignature = makeTimeSignature(6, 8, [0, 720]);
