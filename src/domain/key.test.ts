import { describe, it, expect } from 'vitest';
import { keySignature, diatonicScale, scaleDegreeOf, ALL_KEYS } from './key.js';
import type { Key } from './key.js';
import { prettyPitch } from './pitch.js';
import type { Pitch, NoteName, Accidental } from './pitch.js';

const key = (
  name: NoteName,
  accidental: Accidental,
  mode: Key['mode'],
): Key => ({ tonic: { name, accidental }, mode });

const p = (name: NoteName, accidental: Accidental, octave: number): Pitch => ({
  name,
  accidental,
  octave,
});

// Compact spelling list (letter+accidental) of a scale, ignoring octave.
const spellings = (k: Key): string[] =>
  diatonicScale(k).map((d) => `${d.name}${accGlyph(d.accidental)}`);

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

describe('keySignature', () => {
  it('C major has 0 sharps/flats', () => {
    expect(keySignature(key('C', 'natural', 'major'))).toEqual({ sharps: 0 });
  });
  it('G major has 1 sharp', () => {
    expect(keySignature(key('G', 'natural', 'major'))).toEqual({ sharps: 1 });
  });
  it('F major has 1 flat', () => {
    expect(keySignature(key('F', 'natural', 'major'))).toEqual({ flats: 1 });
  });
  it('F# major has 6 sharps', () => {
    expect(keySignature(key('F', 'sharp', 'major'))).toEqual({ sharps: 6 });
  });
  it('C# major has 7 sharps', () => {
    expect(keySignature(key('C', 'sharp', 'major'))).toEqual({ sharps: 7 });
  });
  it('Gb major has 6 flats', () => {
    expect(keySignature(key('G', 'flat', 'major'))).toEqual({ flats: 6 });
  });
  it('Cb major has 7 flats', () => {
    expect(keySignature(key('C', 'flat', 'major'))).toEqual({ flats: 7 });
  });
  it('A minor has 0 sharps/flats (relative of C major)', () => {
    expect(keySignature(key('A', 'natural', 'minor'))).toEqual({ sharps: 0 });
  });
  it('E minor has 1 sharp (relative of G major)', () => {
    expect(keySignature(key('E', 'natural', 'minor'))).toEqual({ sharps: 1 });
  });
  it('D minor has 1 flat (relative of F major)', () => {
    expect(keySignature(key('D', 'natural', 'minor'))).toEqual({ flats: 1 });
  });
  it('A# minor has 7 sharps (relative of C# major)', () => {
    expect(keySignature(key('A', 'sharp', 'minor'))).toEqual({ sharps: 7 });
  });
  it('Ab minor has 7 flats (relative of Cb major)', () => {
    expect(keySignature(key('A', 'flat', 'minor'))).toEqual({ flats: 7 });
  });
});

describe('diatonicScale natural-letter ordering', () => {
  it('C major = C D E F G A B', () => {
    expect(spellings(key('C', 'natural', 'major'))).toEqual([
      'C', 'D', 'E', 'F', 'G', 'A', 'B',
    ]);
  });
  it('G major = G A B C D E F#', () => {
    expect(spellings(key('G', 'natural', 'major'))).toEqual([
      'G', 'A', 'B', 'C', 'D', 'E', 'F#',
    ]);
  });
  it('F major = F G A Bb C D E', () => {
    expect(spellings(key('F', 'natural', 'major'))).toEqual([
      'F', 'G', 'A', 'Bb', 'C', 'D', 'E',
    ]);
  });
  it('A minor (natural) = A B C D E F G', () => {
    expect(spellings(key('A', 'natural', 'minor'))).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G',
    ]);
  });
});

describe('enharmonic correctness — the hard cases from the brief', () => {
  it('F# major contains E# and B#', () => {
    const s = spellings(key('F', 'sharp', 'major'));
    expect(s).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
    expect(s).toContain('E#');
    expect(s).toContain('B'); // 4th degree is B natural, not Cb
  });

  it('C# major is all sharps including E# and B#', () => {
    const s = spellings(key('C', 'sharp', 'major'));
    expect(s).toEqual(['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#']);
    expect(s).toContain('E#');
    expect(s).toContain('B#');
  });

  it('Gb major contains Cb', () => {
    const s = spellings(key('G', 'flat', 'major'));
    expect(s).toEqual(['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']);
    expect(s).toContain('Cb');
  });

  it('Cb major contains Fb and Cb', () => {
    const s = spellings(key('C', 'flat', 'major'));
    expect(s).toEqual(['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb']);
    expect(s).toContain('Fb');
    expect(s).toContain('Cb');
  });

  it('every diatonic scale uses each of the 7 letters exactly once', () => {
    for (const k of ALL_KEYS) {
      const letters = diatonicScale(k).map((d) => d.name);
      expect(new Set(letters).size).toBe(7);
    }
  });
});

describe('ALL_KEYS', () => {
  it('contains exactly 30 distinct keys (15 major + 15 minor)', () => {
    expect(ALL_KEYS.length).toBe(30);
    const majors = ALL_KEYS.filter((k) => k.mode === 'major');
    const minors = ALL_KEYS.filter((k) => k.mode === 'minor');
    expect(majors.length).toBe(15);
    expect(minors.length).toBe(15);
  });
});

describe('diatonicScale octave assignment', () => {
  it('starts the tonic at octave 4 and ascends within an octave', () => {
    const scale = diatonicScale(key('C', 'natural', 'major'));
    expect(scale[0]).toEqual(p('C', 'natural', 4));
    expect(scale[6]).toEqual(p('B', 'natural', 4));
  });
  it('handles G major crossing into next octave letters', () => {
    const scale = diatonicScale(key('G', 'natural', 'major'));
    expect(prettyPitch(scale[0]!)).toBe('G4');
    expect(prettyPitch(scale[3]!)).toBe('C5'); // C is above G within the octave
  });
});

describe('scaleDegreeOf', () => {
  it('returns 1-based degree for diatonic pitches', () => {
    const cmaj = key('C', 'natural', 'major');
    expect(scaleDegreeOf(p('C', 'natural', 4), cmaj)).toBe(1);
    expect(scaleDegreeOf(p('G', 'natural', 4), cmaj)).toBe(5);
    expect(scaleDegreeOf(p('B', 'natural', 3), cmaj)).toBe(7);
  });
  it('returns null for non-diatonic pitches', () => {
    const cmaj = key('C', 'natural', 'major');
    expect(scaleDegreeOf(p('F', 'sharp', 4), cmaj)).toBeNull();
  });
  it('matches by pitch class regardless of octave', () => {
    const gmaj = key('G', 'natural', 'major');
    expect(scaleDegreeOf(p('F', 'sharp', 5), gmaj)).toBe(7);
  });
});
