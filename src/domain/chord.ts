// Chord: ceiling is the seventh chord (no 9/11/13). Chord tones are spelled by
// stacking thirds from the root with the correct (letter-step, semitone) recipe
// for each quality, so enharmonic spelling stays correct (e.g. G7 -> G B D F,
// and a fully-diminished 7th keeps its diminished-seventh spelling).

import type { Pitch, NoteName, Accidental } from './pitch.js';
import { pitchToMidi } from './pitch.js';
import type { Key } from './key.js';
import { diatonicScale } from './key.js';

export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';
export type SeventhQuality =
  | 'major7'
  | 'minor7'
  | 'dominant7'
  | 'minorMajor7'
  | 'halfDiminished'
  | 'fullyDiminished'
  | 'augmentedMajor7'
  | 'augmented7';
export type ChordQuality = TriadQuality | SeventhQuality;

export interface Chord {
  root: Pitch;
  quality: ChordQuality;
  inversion?: 0 | 1 | 2 | 3;
}

const LETTERS: ReadonlyArray<NoteName> = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
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

// Each chord tone above the root is described by how many LETTERS up it is (the
// interval size minus one) and how many SEMITONES above the root it sounds.
// Stacking by letter keeps the spelling diatonic-by-thirds.
interface ToneSpec {
  letterStep: number; // 0 = root, 2 = third, 4 = fifth, 6 = seventh
  semitones: number; // semitones above the root
}

const QUALITY_SPECS: Readonly<Record<ChordQuality, ReadonlyArray<ToneSpec>>> = {
  // Triads
  major: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 7 },
  ],
  minor: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 7 },
  ],
  diminished: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 6 },
  ],
  augmented: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 8 },
  ],
  // Sevenths
  major7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 7 },
    { letterStep: 6, semitones: 11 },
  ],
  minor7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 7 },
    { letterStep: 6, semitones: 10 },
  ],
  dominant7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 7 },
    { letterStep: 6, semitones: 10 },
  ],
  minorMajor7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 7 },
    { letterStep: 6, semitones: 11 },
  ],
  halfDiminished: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 6 },
    { letterStep: 6, semitones: 10 },
  ],
  fullyDiminished: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 3 },
    { letterStep: 4, semitones: 6 },
    { letterStep: 6, semitones: 9 }, // diminished seventh
  ],
  augmentedMajor7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 8 },
    { letterStep: 6, semitones: 11 },
  ],
  augmented7: [
    { letterStep: 0, semitones: 0 },
    { letterStep: 2, semitones: 4 },
    { letterStep: 4, semitones: 8 },
    { letterStep: 6, semitones: 10 },
  ],
};

/**
 * Spell the pitch that is `letterStep` letters above `root` and sounds
 * `semitones` above it. The letter is fixed by stepping the alphabet; the
 * accidental is whatever makes the sounding semitone come out right.
 */
function spellTone(root: Pitch, spec: ToneSpec): Pitch {
  const rootLetterIdx = LETTERS.indexOf(root.name);
  const targetLetterIdx = (rootLetterIdx + spec.letterStep) % 7;
  const targetLetter = LETTERS[targetLetterIdx]!;

  // Octave: how many times we wrapped past B.
  const octaveBump = Math.floor((rootLetterIdx + spec.letterStep) / 7);
  const octave = root.octave + octaveBump;

  // Desired sounding MIDI = root MIDI + semitones.
  const targetMidi = pitchToMidi(root) + spec.semitones;
  // Natural MIDI of the target letter at that octave.
  const naturalMidi = (octave + 1) * 12 + LETTER_SEMITONE[targetLetter];
  const accOffset = targetMidi - naturalMidi;

  const accidental = (Object.keys(ACCIDENTAL_OFFSET) as Accidental[]).find(
    (a) => ACCIDENTAL_OFFSET[a] === accOffset,
  );
  if (accidental === undefined) {
    throw new Error(
      `cannot spell chord tone ${spec.letterStep}/${spec.semitones} from ${root.name}`,
    );
  }
  return { name: targetLetter, accidental, octave };
}

/** Root/third/fifth (and seventh for seventh chords), correctly spelled. */
export function chordTones(chord: Chord): Pitch[] {
  return QUALITY_SPECS[chord.quality].map((spec) => spellTone(chord.root, spec));
}

// --- Roman numeral parsing ---------------------------------------------------

// Map Roman numeral letters to a 1-based scale degree.
const ROMAN_TO_DEGREE: ReadonlyMap<string, number> = new Map([
  ['i', 1],
  ['ii', 2],
  ['iii', 3],
  ['iv', 4],
  ['v', 5],
  ['vi', 6],
  ['vii', 7],
]);

interface ParsedRoman {
  degree: number; // 1-7
  upperCase: boolean; // case of the numeral (informational; quality is explicit)
}

/**
 * Parse a Roman numeral like "ii", "V7", "viio", "IV" into a scale degree and its
 * letter case. Trailing quality markers (7, o, +, ø, etc.) are ignored — the
 * explicit `quality` argument to romanNumeralToChord is authoritative.
 */
function parseRoman(rn: string): ParsedRoman {
  // Strip everything that is not a roman-numeral letter from the front.
  const match = rn.match(/^[ivIV]+/);
  if (!match) {
    throw new Error(`unparseable Roman numeral: "${rn}"`);
  }
  const letters = match[0];
  const upperCase = letters === letters.toUpperCase();
  const degree = ROMAN_TO_DEGREE.get(letters.toLowerCase());
  if (degree === undefined) {
    throw new Error(`unknown Roman numeral degree: "${letters}"`);
  }
  return { degree, upperCase };
}

const DIMINISHED_FAMILY: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  'diminished',
  'halfDiminished',
  'fullyDiminished',
]);

function chromaticRaise(p: Pitch): Pitch {
  // Raise by one chromatic semitone while keeping the letter (natural->sharp,
  // flat->natural, sharp->doubleSharp). This turns the natural-minor subtonic
  // into the leading tone (Bb -> B, or B -> B#).
  const next: Readonly<Record<Accidental, Accidental>> = {
    doubleFlat: 'flat',
    flat: 'natural',
    natural: 'sharp',
    sharp: 'doubleSharp',
    doubleSharp: 'doubleSharp', // already at ceiling; should not occur in practice
  };
  return { name: p.name, accidental: next[p.accidental], octave: p.octave };
}

/**
 * Instantiate a Roman numeral into a concrete Chord in the given key.
 *
 * The root is the diatonic scale degree of `key` (natural minor for minor keys),
 * EXCEPT for the minor-key leading-tone chord: degree 7 written lowercase / with a
 * diminished quality is the RAISED leading tone (B in C minor), distinct from VII
 * (the subtonic Bb major). The chord quality is taken from the explicit `quality`
 * argument — V in minor is "major"/"dominant7" with the leading tone arriving
 * through the chord's third, so no root adjustment is needed there.
 */
export function romanNumeralToChord(
  rn: string,
  quality: ChordQuality,
  key: Key,
  inversion?: 0 | 1 | 2 | 3,
): Chord {
  const { degree, upperCase } = parseRoman(rn);
  const scale = diatonicScale(key);
  const degreePitch = scale[degree - 1]!;

  let root: Pitch = { ...degreePitch };

  // Minor-key leading-tone chord: the natural-minor 7th degree is the subtonic.
  // When the numeral is the leading-tone chord (lowercase vii with a diminished
  // quality), raise the root to the leading tone. Uppercase VII stays the subtonic.
  if (
    key.mode === 'minor' &&
    degree === 7 &&
    !upperCase &&
    DIMINISHED_FAMILY.has(quality)
  ) {
    root = chromaticRaise(degreePitch);
  }

  return inversion === undefined
    ? { root, quality }
    : { root, quality, inversion };
}
