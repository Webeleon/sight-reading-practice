// Key & diatonic spelling. Enharmonic keys are DISTINCT (F# major != Gb major):
// 30 keys total (15 major + 15 minor). Spelling is derived from the key signature
// using the circle of fifths and the standard order of accidentals, which is what
// makes hard cases come out right (F# major has E# and B#; Cb major has Fb and Cb).

import type { NoteName, Accidental, Pitch } from './pitch.js';
import { pitchClass } from './pitch.js';

export type Mode = 'major' | 'minor';

export interface Key {
  tonic: { name: NoteName; accidental: Accidental };
  mode: Mode;
}

export type KeySignature = { sharps: number } | { flats: number };

// Order in which letters take sharps and flats in a key signature.
const SHARP_ORDER: ReadonlyArray<NoteName> = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: ReadonlyArray<NoteName> = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

// Letter sequence for stepping through a scale by letter name.
const LETTERS: ReadonlyArray<NoteName> = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Number of sharps (positive) or flats (negative) on the circle of fifths for each
// MAJOR tonic spelling. Keyed by "name+accidentalGlyph". Range -7..+7.
const MAJOR_FIFTHS: ReadonlyMap<string, number> = new Map([
  ['Cb', -7],
  ['Gb', -6],
  ['Db', -5],
  ['Ab', -4],
  ['Eb', -3],
  ['Bb', -2],
  ['F', -1],
  ['C', 0],
  ['G', 1],
  ['D', 2],
  ['A', 3],
  ['E', 4],
  ['B', 5],
  ['F#', 6],
  ['C#', 7],
]);

function accGlyph(a: Accidental): string {
  switch (a) {
    case 'natural':
      return '';
    case 'sharp':
      return '#';
    case 'flat':
      return 'b';
    case 'doubleSharp':
      return 'x';
    case 'doubleFlat':
      return 'bb';
  }
}

function tonicGlyph(t: Key['tonic']): string {
  return `${t.name}${accGlyph(t.accidental)}`;
}

function letterIndex(name: NoteName): number {
  return LETTERS.indexOf(name);
}

/**
 * For a minor key, the relative major's tonic is a minor third (3 letters) up:
 * A minor -> C major, E minor -> G major, etc. The relative major has the same
 * key signature. We return its tonic glyph so we can reuse MAJOR_FIFTHS.
 */
function relativeMajorGlyph(t: Key['tonic']): string {
  // Relative major is 3 semitones above the minor tonic, spelled 2 letters up
  // (a minor third). e.g. A -> C, E -> G, B -> D, F# -> A, etc.
  const minorPc = pitchClass({ name: t.name, accidental: t.accidental, octave: 4 });
  const majorPc = (minorPc + 3) % 12;
  const majorLetterIdx = (letterIndex(t.name) + 2) % 7;
  const majorLetter = LETTERS[majorLetterIdx]!;
  // Choose the accidental so the spelled letter lands on majorPc.
  return spellLetterToPitchClass(majorLetter, majorPc);
}

// Semitone of each natural letter above C.
const LETTER_SEMITONE: Readonly<Record<NoteName, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Pick the accidental glyph string so `letter` sounds at pitch class `pc`. */
function spellLetterToPitchClass(letter: NoteName, pc: number): string {
  const natural = LETTER_SEMITONE[letter];
  let diff = ((pc - natural) % 12 + 12) % 12;
  if (diff > 6) diff -= 12; // choose nearest direction
  switch (diff) {
    case -2:
      return `${letter}bb`;
    case -1:
      return `${letter}b`;
    case 0:
      return `${letter}`;
    case 1:
      return `${letter}#`;
    case 2:
      return `${letter}x`;
    default:
      throw new Error(`cannot spell letter ${letter} to pitch class ${pc}`);
  }
}

/** Circle-of-fifths position (sharps>0, flats<0) for any key. */
function fifthsOf(key: Key): number {
  const glyph =
    key.mode === 'major' ? tonicGlyph(key.tonic) : relativeMajorGlyph(key.tonic);
  const f = MAJOR_FIFTHS.get(glyph);
  if (f === undefined) {
    throw new Error(`unknown key tonic spelling: ${glyph}`);
  }
  return f;
}

export function keySignature(key: Key): KeySignature {
  const f = fifthsOf(key);
  return f >= 0 ? { sharps: f } : { flats: -f };
}

/**
 * The set of accidentals implied by a key signature, as a map from letter to its
 * accidental in that key. Letters not in the map are natural.
 */
function signatureAccidentals(fifths: number): Map<NoteName, Accidental> {
  const out = new Map<NoteName, Accidental>();
  if (fifths > 0) {
    for (let i = 0; i < fifths; i++) {
      out.set(SHARP_ORDER[i]!, 'sharp');
    }
  } else if (fifths < 0) {
    for (let i = 0; i < -fifths; i++) {
      out.set(FLAT_ORDER[i]!, 'flat');
    }
  }
  return out;
}

/**
 * The 7 correctly-spelled scale degrees of a key, tonic first, ascending within
 * a single octave starting at octave 4. For minor we return the NATURAL minor
 * scale (no raised 7th) — raised leading tones are a chord/harmony concern handled
 * in chord.ts, not the scale itself.
 *
 * Each letter is used exactly once; accidentals come straight from the key
 * signature, which is why F# major yields E#/B# and Cb major yields Fb/Cb.
 */
export function diatonicScale(key: Key): Pitch[] {
  const fifths = fifthsOf(key);
  const accidentals = signatureAccidentals(fifths);

  const startLetterIdx = letterIndex(key.tonic.name);
  const result: Pitch[] = [];
  let octave = 4;
  let prevLetterIdx = -1;

  for (let step = 0; step < 7; step++) {
    const letterIdx = (startLetterIdx + step) % 7;
    const letter = LETTERS[letterIdx]!;
    // Octave bumps each time we wrap past B back toward C.
    if (prevLetterIdx !== -1 && letterIdx <= prevLetterIdx) {
      octave += 1;
    }
    prevLetterIdx = letterIdx;
    const accidental = accidentals.get(letter) ?? 'natural';
    result.push({ name: letter, accidental, octave });
  }
  return result;
}

/**
 * 1-based scale degree of a pitch within a key (matched by pitch class), or null
 * if the pitch is not diatonic.
 */
export function scaleDegreeOf(pitch: Pitch, key: Key): number | null {
  const pc = pitchClass(pitch);
  const scale = diatonicScale(key);
  for (let i = 0; i < scale.length; i++) {
    if (pitchClass(scale[i]!) === pc) {
      return i + 1;
    }
  }
  return null;
}

// --- The canonical 30 keys ---------------------------------------------------

const MAJOR_TONICS: ReadonlyArray<{ name: NoteName; accidental: Accidental }> = [
  { name: 'C', accidental: 'flat' },
  { name: 'G', accidental: 'flat' },
  { name: 'D', accidental: 'flat' },
  { name: 'A', accidental: 'flat' },
  { name: 'E', accidental: 'flat' },
  { name: 'B', accidental: 'flat' },
  { name: 'F', accidental: 'natural' },
  { name: 'C', accidental: 'natural' },
  { name: 'G', accidental: 'natural' },
  { name: 'D', accidental: 'natural' },
  { name: 'A', accidental: 'natural' },
  { name: 'E', accidental: 'natural' },
  { name: 'B', accidental: 'natural' },
  { name: 'F', accidental: 'sharp' },
  { name: 'C', accidental: 'sharp' },
];

// Minor tonics: relative minor of each major (down a minor third). 15 of them,
// from Ab minor (7 flats) through A# minor (7 sharps).
const MINOR_TONICS: ReadonlyArray<{ name: NoteName; accidental: Accidental }> = [
  { name: 'A', accidental: 'flat' },
  { name: 'E', accidental: 'flat' },
  { name: 'B', accidental: 'flat' },
  { name: 'F', accidental: 'natural' },
  { name: 'C', accidental: 'natural' },
  { name: 'G', accidental: 'natural' },
  { name: 'D', accidental: 'natural' },
  { name: 'A', accidental: 'natural' },
  { name: 'E', accidental: 'natural' },
  { name: 'B', accidental: 'natural' },
  { name: 'F', accidental: 'sharp' },
  { name: 'C', accidental: 'sharp' },
  { name: 'G', accidental: 'sharp' },
  { name: 'D', accidental: 'sharp' },
  { name: 'A', accidental: 'sharp' },
];

export const ALL_KEYS: ReadonlyArray<Key> = [
  ...MAJOR_TONICS.map((tonic): Key => ({ tonic, mode: 'major' })),
  ...MINOR_TONICS.map((tonic): Key => ({ tonic, mode: 'minor' })),
];
