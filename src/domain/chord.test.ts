import { describe, it, expect } from 'vitest';
import { chordTones, romanNumeralToChord } from './chord.js';
import type { Chord } from './chord.js';
import type { Key, Mode } from './key.js';
import type { Pitch, NoteName, Accidental } from './pitch.js';
import { prettyPitch } from './pitch.js';

const key = (name: NoteName, accidental: Accidental, mode: Mode): Key => ({
  tonic: { name, accidental },
  mode,
});
const p = (name: NoteName, accidental: Accidental, octave: number): Pitch => ({
  name,
  accidental,
  octave,
});

// Compact tone spellings (letter+accidental), octave-agnostic.
const tones = (c: Chord): string[] =>
  chordTones(c).map((t) => `${t.name}${accGlyph(t.accidental)}`);

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

describe('chordTones — triads', () => {
  it('C major = C E G', () => {
    expect(tones({ root: p('C', 'natural', 4), quality: 'major' })).toEqual([
      'C', 'E', 'G',
    ]);
  });
  it('A minor = A C E', () => {
    expect(tones({ root: p('A', 'natural', 4), quality: 'minor' })).toEqual([
      'A', 'C', 'E',
    ]);
  });
  it('B diminished = B D F', () => {
    expect(tones({ root: p('B', 'natural', 4), quality: 'diminished' })).toEqual([
      'B', 'D', 'F',
    ]);
  });
  it('C augmented = C E G#', () => {
    expect(tones({ root: p('C', 'natural', 4), quality: 'augmented' })).toEqual([
      'C', 'E', 'G#',
    ]);
  });
});

describe('chordTones — sevenths', () => {
  it('G dominant7 = G B D F', () => {
    expect(tones({ root: p('G', 'natural', 4), quality: 'dominant7' })).toEqual([
      'G', 'B', 'D', 'F',
    ]);
  });
  it('C major7 = C E G B', () => {
    expect(tones({ root: p('C', 'natural', 4), quality: 'major7' })).toEqual([
      'C', 'E', 'G', 'B',
    ]);
  });
  it('D minor7 = D F A C', () => {
    expect(tones({ root: p('D', 'natural', 4), quality: 'minor7' })).toEqual([
      'D', 'F', 'A', 'C',
    ]);
  });
  it('B half-diminished = B D F A', () => {
    expect(tones({ root: p('B', 'natural', 4), quality: 'halfDiminished' })).toEqual([
      'B', 'D', 'F', 'A',
    ]);
  });
  it('B fully-diminished = B D F Ab', () => {
    expect(tones({ root: p('B', 'natural', 4), quality: 'fullyDiminished' })).toEqual([
      'B', 'D', 'F', 'Ab',
    ]);
  });
  it('C minorMajor7 = C Eb G B', () => {
    expect(tones({ root: p('C', 'natural', 4), quality: 'minorMajor7' })).toEqual([
      'C', 'Eb', 'G', 'B',
    ]);
  });
});

describe('chordTones — octave continuity', () => {
  it('keeps tones ascending within/above the root octave', () => {
    const c: Chord = { root: p('G', 'natural', 4), quality: 'dominant7' };
    const ts = chordTones(c);
    expect(prettyPitch(ts[0]!)).toBe('G4');
    expect(prettyPitch(ts[1]!)).toBe('B4');
    expect(prettyPitch(ts[2]!)).toBe('D5');
    expect(prettyPitch(ts[3]!)).toBe('F5');
  });
});

describe('romanNumeralToChord — major key', () => {
  const C = key('C', 'natural', 'major');
  it('ii minor7 in C major = Dm7 (D F A C)', () => {
    const c = romanNumeralToChord('ii', 'minor7', C);
    expect(prettyPitch(c.root)).toBe('D4');
    expect(c.quality).toBe('minor7');
    expect(tones(c)).toEqual(['D', 'F', 'A', 'C']);
  });
  it('V7 dominant7 in C major = G7 (G B D F)', () => {
    const c = romanNumeralToChord('V', 'dominant7', C);
    expect(prettyPitch(c.root)).toBe('G4');
    expect(tones(c)).toEqual(['G', 'B', 'D', 'F']);
  });
  it('I major in C major = C E G', () => {
    const c = romanNumeralToChord('I', 'major', C);
    expect(tones(c)).toEqual(['C', 'E', 'G']);
  });
  it('vii diminished in C major = B D F', () => {
    const c = romanNumeralToChord('vii', 'diminished', C);
    expect(prettyPitch(c.root)).toBe('B4');
    expect(tones(c)).toEqual(['B', 'D', 'F']);
  });
  it('IV in G major = C (root spelled C natural)', () => {
    const c = romanNumeralToChord('IV', 'major', key('G', 'natural', 'major'));
    expect(prettyPitch(c.root)).toBe('C5');
  });
});

describe('romanNumeralToChord — minor key (the hard cases)', () => {
  const Cm = key('C', 'natural', 'minor');

  it('ii in C minor is the supertonic — root D, half-diminished (D F Ab C)', () => {
    const c = romanNumeralToChord('ii', 'halfDiminished', Cm);
    expect(prettyPitch(c.root)).toBe('D4');
    expect(tones(c)).toEqual(['D', 'F', 'Ab', 'C']);
  });

  it('V in C minor is MAJOR with raised leading tone (G B D, B natural)', () => {
    const c = romanNumeralToChord('V', 'major', Cm);
    expect(prettyPitch(c.root)).toBe('G4');
    expect(tones(c)).toEqual(['G', 'B', 'D']); // B natural = raised leading tone
  });

  it('V7 in C minor = G B D F (dominant7, leading tone raised)', () => {
    const c = romanNumeralToChord('V', 'dominant7', Cm);
    expect(tones(c)).toEqual(['G', 'B', 'D', 'F']);
  });

  it('III in C minor is MAJOR on the natural mediant (Eb G Bb)', () => {
    const c = romanNumeralToChord('III', 'major', Cm);
    expect(prettyPitch(c.root)).toBe('Eb4');
    expect(tones(c)).toEqual(['Eb', 'G', 'Bb']);
  });

  it('i in C minor = C Eb G', () => {
    const c = romanNumeralToChord('i', 'minor', Cm);
    expect(tones(c)).toEqual(['C', 'Eb', 'G']);
  });

  it('iv in C minor = F Ab C', () => {
    const c = romanNumeralToChord('iv', 'minor', Cm);
    expect(tones(c)).toEqual(['F', 'Ab', 'C']);
  });

  it('VI in C minor is the natural submediant Ab (Ab C Eb)', () => {
    const c = romanNumeralToChord('VI', 'major', Cm);
    expect(prettyPitch(c.root)).toBe('Ab4');
    expect(tones(c)).toEqual(['Ab', 'C', 'Eb']);
  });

  it('VII (subtonic) in C minor is Bb major (Bb D F) — root Bb natural', () => {
    const c = romanNumeralToChord('VII', 'major', Cm);
    expect(prettyPitch(c.root)).toBe('Bb4');
    expect(tones(c)).toEqual(['Bb', 'D', 'F']);
  });

  it('vii (leading-tone) in C minor is B diminished (B D F) — root raised to B natural', () => {
    const c = romanNumeralToChord('vii', 'diminished', Cm);
    expect(prettyPitch(c.root)).toBe('B4');
    expect(tones(c)).toEqual(['B', 'D', 'F']);
  });

  it('vii fully-diminished7 in C minor = B D F Ab', () => {
    const c = romanNumeralToChord('vii', 'fullyDiminished', Cm);
    expect(prettyPitch(c.root)).toBe('B4');
    expect(tones(c)).toEqual(['B', 'D', 'F', 'Ab']);
  });
});

describe('romanNumeralToChord — accepts trailing quality markers in the numeral', () => {
  it('parses "V7" and "ii" the same as bare degree numerals', () => {
    const C = key('C', 'natural', 'major');
    expect(prettyPitch(romanNumeralToChord('V7', 'dominant7', C).root)).toBe('G4');
    expect(prettyPitch(romanNumeralToChord('viio', 'diminished', C).root)).toBe('B4');
  });
});

describe('inversion field', () => {
  it('passes inversion through when provided', () => {
    const C = key('C', 'natural', 'major');
    const c = romanNumeralToChord('I', 'major', C, 1);
    expect(c.inversion).toBe(1);
  });
});

describe('JSON round-trip', () => {
  it('chord survives stringify/parse', () => {
    const c: Chord = { root: p('G', 'natural', 4), quality: 'dominant7', inversion: 0 };
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});
