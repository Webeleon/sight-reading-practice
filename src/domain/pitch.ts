// Pitch: scientific pitch notation. Middle C is octave 4 (C4 = MIDI 60).
// Enharmonic keys are DISTINCT, so spelling (name + accidental) is first-class and
// must be preserved; MIDI is the lossy projection, not the source of truth.

export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental =
  | 'natural'
  | 'sharp'
  | 'flat'
  | 'doubleSharp'
  | 'doubleFlat';

export interface Pitch {
  name: NoteName;
  accidental: Accidental;
  octave: number; // scientific pitch notation; middle C is octave 4
}

// Semitone offset of each natural letter above C within an octave.
const LETTER_SEMITONE: Readonly<Record<NoteName, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const ACCIDENTAL_OFFSET: Readonly<Record<Accidental, number>> = {
  doubleFlat: -2,
  flat: -1,
  natural: 0,
  sharp: 1,
  doubleSharp: 2,
};

/**
 * MIDI number for a pitch. C4 (middle C) = 60, so C-1 = 0.
 * Spelling is collapsed here (E#4 and F4 both -> 65). This is the lossy direction.
 */
export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + LETTER_SEMITONE[p.name] + ACCIDENTAL_OFFSET[p.accidental];
}

/** Pitch class 0-11 (C=0). Spelling-independent. */
export function pitchClass(p: Pitch): number {
  return ((pitchToMidi(p) % 12) + 12) % 12;
}

/** Two pitches are enharmonically equal iff they sound the same (same MIDI). */
export function pitchesEnharmonicEqual(a: Pitch, b: Pitch): boolean {
  return pitchToMidi(a) === pitchToMidi(b);
}

const ACCIDENTAL_GLYPH: Readonly<Record<Accidental, string>> = {
  natural: '',
  sharp: '#',
  flat: 'b',
  doubleSharp: 'x',
  doubleFlat: 'bb',
};

/** Human-readable form: "F#4", "Bb3", "C4", "Fx4" (double-sharp), "Bbb3". */
export function prettyPitch(p: Pitch): string {
  return `${p.name}${ACCIDENTAL_GLYPH[p.accidental]}${p.octave}`;
}

// --- Key-aware spelling for the lossy MIDI -> Pitch direction ----------------
//
// We resolve a MIDI number to a spelled Pitch by consulting the key's diatonic
// scale: if the sounding pitch class matches a scale degree, spell it exactly as
// that degree (this is what makes F# major spell MIDI 65 as E#, not F natural).
// For chromatic (non-diatonic) pitch classes we fall back to a sharp/flat default
// chosen by the key signature direction.

import type { Key } from './key.js';
import { diatonicScale, keySignature } from './key.js';

// Default spelling for each pitch class, sharp-oriented and flat-oriented.
// Index = pitch class 0-11.
const SHARP_SPELLING: ReadonlyArray<{ name: NoteName; accidental: Accidental }> = [
  { name: 'C', accidental: 'natural' },
  { name: 'C', accidental: 'sharp' },
  { name: 'D', accidental: 'natural' },
  { name: 'D', accidental: 'sharp' },
  { name: 'E', accidental: 'natural' },
  { name: 'F', accidental: 'natural' },
  { name: 'F', accidental: 'sharp' },
  { name: 'G', accidental: 'natural' },
  { name: 'G', accidental: 'sharp' },
  { name: 'A', accidental: 'natural' },
  { name: 'A', accidental: 'sharp' },
  { name: 'B', accidental: 'natural' },
];

const FLAT_SPELLING: ReadonlyArray<{ name: NoteName; accidental: Accidental }> = [
  { name: 'C', accidental: 'natural' },
  { name: 'D', accidental: 'flat' },
  { name: 'D', accidental: 'natural' },
  { name: 'E', accidental: 'flat' },
  { name: 'E', accidental: 'natural' },
  { name: 'F', accidental: 'natural' },
  { name: 'G', accidental: 'flat' },
  { name: 'G', accidental: 'natural' },
  { name: 'A', accidental: 'flat' },
  { name: 'A', accidental: 'natural' },
  { name: 'B', accidental: 'flat' },
  { name: 'B', accidental: 'natural' },
];

/**
 * Compute the correct octave for a spelled letter/accidental so that the spelled
 * pitch sounds at `midi`. Necessary because, e.g., Cb belongs to the octave above
 * its sounding B (Cb5 sounds as MIDI 59 = B4).
 */
function octaveForSpelling(
  name: NoteName,
  accidental: Accidental,
  midi: number,
): number {
  // The bare-natural semitone of this letter, plus accidental offset, must equal
  // (midi mod 12) when reduced. Solve for octave from the absolute MIDI.
  const base = LETTER_SEMITONE[name] + ACCIDENTAL_OFFSET[accidental];
  // midi = (octave + 1) * 12 + base  =>  octave = (midi - base) / 12 - 1
  return Math.round((midi - base) / 12) - 1;
}

/**
 * Resolve a MIDI number to a spelled Pitch using the given key for context.
 * Diatonic pitch classes are spelled exactly as the key's scale degree (so sharp
 * keys keep their sharps, flat keys their flats, and F# major spells E#/B#).
 * Chromatic pitch classes use the key's overall sharp/flat orientation.
 */
export function midiToPitch(midi: number, keyContext: Key): Pitch {
  const pc = ((midi % 12) + 12) % 12;

  // 1. Prefer the diatonic spelling if this pitch class is in the scale.
  const scale = diatonicScale(keyContext);
  for (const degree of scale) {
    if (pitchClass(degree) === pc) {
      const octave = octaveForSpelling(degree.name, degree.accidental, midi);
      return { name: degree.name, accidental: degree.accidental, octave };
    }
  }

  // 2. Chromatic: choose sharp- or flat-oriented default by key signature.
  const sig = keySignature(keyContext);
  const useFlats = 'flats' in sig && sig.flats > 0;
  const table = useFlats ? FLAT_SPELLING : SHARP_SPELLING;
  const spelling = table[pc]!;
  const octave = octaveForSpelling(spelling.name, spelling.accidental, midi);
  return { name: spelling.name, accidental: spelling.accidental, octave };
}
