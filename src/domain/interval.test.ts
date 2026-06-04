import { describe, it, expect } from 'vitest';
import { intervalBetween } from './interval.js';
import type { Pitch, NoteName, Accidental } from './pitch.js';

const p = (name: NoteName, accidental: Accidental, octave: number): Pitch => ({
  name,
  accidental,
  octave,
});

describe('intervalBetween — perfect & major/minor', () => {
  it('unison C4-C4', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('C', 'natural', 4));
    expect(i.size).toBe(1);
    expect(i.quality).toBe('perfect');
    expect(i.semitones).toBe(0);
    expect(i.direction).toBe('unison');
  });

  it('major third C4-E4', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('E', 'natural', 4));
    expect(i.size).toBe(3);
    expect(i.quality).toBe('major');
    expect(i.semitones).toBe(4);
    expect(i.direction).toBe('ascending');
  });

  it('minor third E4-G4', () => {
    const i = intervalBetween(p('E', 'natural', 4), p('G', 'natural', 4));
    expect(i.size).toBe(3);
    expect(i.quality).toBe('minor');
    expect(i.semitones).toBe(3);
  });

  it('perfect fifth C4-G4', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('G', 'natural', 4));
    expect(i.size).toBe(5);
    expect(i.quality).toBe('perfect');
    expect(i.semitones).toBe(7);
  });

  it('perfect octave C4-C5', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('C', 'natural', 5));
    expect(i.size).toBe(8);
    expect(i.quality).toBe('perfect');
    expect(i.semitones).toBe(12);
  });

  it('perfect fourth C4-F4', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('F', 'natural', 4));
    expect(i.size).toBe(4);
    expect(i.quality).toBe('perfect');
    expect(i.semitones).toBe(5);
  });

  it('major second C4-D4, minor second E4-F4', () => {
    expect(intervalBetween(p('C', 'natural', 4), p('D', 'natural', 4)).quality).toBe(
      'major',
    );
    expect(intervalBetween(p('E', 'natural', 4), p('F', 'natural', 4)).quality).toBe(
      'minor',
    );
  });
});

describe('intervalBetween — augmented & diminished (spelling-aware)', () => {
  it('augmented fourth C4-F#4 (tritone spelled as A4)', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('F', 'sharp', 4));
    expect(i.size).toBe(4);
    expect(i.quality).toBe('augmented');
    expect(i.semitones).toBe(6);
  });

  it('diminished fifth C4-Gb4 (same 6 semitones, different spelling)', () => {
    const i = intervalBetween(p('C', 'natural', 4), p('G', 'flat', 4));
    expect(i.size).toBe(5);
    expect(i.quality).toBe('diminished');
    expect(i.semitones).toBe(6);
  });

  it('augmented second Bb3-C#4', () => {
    const i = intervalBetween(p('B', 'flat', 3), p('C', 'sharp', 4));
    expect(i.size).toBe(2);
    expect(i.quality).toBe('augmented');
    expect(i.semitones).toBe(3);
  });

  it('diminished seventh C#4-Bb4', () => {
    const i = intervalBetween(p('C', 'sharp', 4), p('B', 'flat', 4));
    expect(i.size).toBe(7);
    expect(i.quality).toBe('diminished');
    expect(i.semitones).toBe(9);
  });
});

describe('intervalBetween — direction', () => {
  it('descending major third E4-C4', () => {
    const i = intervalBetween(p('E', 'natural', 4), p('C', 'natural', 4));
    expect(i.size).toBe(3);
    expect(i.quality).toBe('major');
    expect(i.semitones).toBe(4);
    expect(i.direction).toBe('descending');
  });
});
