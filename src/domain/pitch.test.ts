import { describe, it, expect } from 'vitest';
import {
  pitchToMidi,
  midiToPitch,
  pitchClass,
  pitchesEnharmonicEqual,
  prettyPitch,
} from './pitch.js';
import type { Pitch } from './pitch.js';
import type { Key } from './key.js';

const p = (
  name: Pitch['name'],
  accidental: Pitch['accidental'],
  octave: number,
): Pitch => ({ name, accidental, octave });

const major = (tonic: Pitch): Key => ({
  tonic: { name: tonic.name, accidental: tonic.accidental },
  mode: 'major',
});

describe('pitchToMidi', () => {
  it('places middle C (C4) at MIDI 60', () => {
    expect(pitchToMidi(p('C', 'natural', 4))).toBe(60);
  });

  it('places low E (E2, guitar string 1) at MIDI 40', () => {
    expect(pitchToMidi(p('E', 'natural', 2))).toBe(40);
  });

  it('places high E (E4, guitar string 6 open... E5 at 76) — A4 at 69 (concert pitch)', () => {
    expect(pitchToMidi(p('A', 'natural', 4))).toBe(69);
  });

  it('handles sharps and flats', () => {
    expect(pitchToMidi(p('F', 'sharp', 4))).toBe(66);
    expect(pitchToMidi(p('B', 'flat', 3))).toBe(58);
  });

  it('handles double accidentals', () => {
    expect(pitchToMidi(p('F', 'doubleSharp', 4))).toBe(67); // == G4
    expect(pitchToMidi(p('B', 'doubleFlat', 4))).toBe(69); // == A4
  });

  it('treats enharmonics as same MIDI', () => {
    expect(pitchToMidi(p('E', 'sharp', 4))).toBe(pitchToMidi(p('F', 'natural', 4)));
    expect(pitchToMidi(p('C', 'flat', 5))).toBe(pitchToMidi(p('B', 'natural', 4)));
  });
});

describe('pitchClass', () => {
  it('returns 0-11', () => {
    expect(pitchClass(p('C', 'natural', 4))).toBe(0);
    expect(pitchClass(p('C', 'sharp', 4))).toBe(1);
    expect(pitchClass(p('B', 'natural', 4))).toBe(11);
    expect(pitchClass(p('C', 'flat', 4))).toBe(11); // Cb == B
    expect(pitchClass(p('B', 'sharp', 4))).toBe(0); // B# == C
  });
});

describe('pitchesEnharmonicEqual', () => {
  it('is true for E# and F', () => {
    expect(pitchesEnharmonicEqual(p('E', 'sharp', 4), p('F', 'natural', 4))).toBe(true);
  });
  it('is false for C4 and C5', () => {
    expect(pitchesEnharmonicEqual(p('C', 'natural', 4), p('C', 'natural', 5))).toBe(false);
  });
  it('is true for Cb5 and B4 (octave boundary)', () => {
    expect(pitchesEnharmonicEqual(p('C', 'flat', 5), p('B', 'natural', 4))).toBe(true);
  });
});

describe('prettyPitch', () => {
  it('formats F#4 and Bb3', () => {
    expect(prettyPitch(p('F', 'sharp', 4))).toBe('F#4');
    expect(prettyPitch(p('B', 'flat', 3))).toBe('Bb3');
  });
  it('formats naturals without symbol', () => {
    expect(prettyPitch(p('C', 'natural', 4))).toBe('C4');
  });
  it('formats double accidentals', () => {
    expect(prettyPitch(p('F', 'doubleSharp', 4))).toBe('Fx4');
    expect(prettyPitch(p('B', 'doubleFlat', 3))).toBe('Bbb3');
  });
});

describe('midiToPitch round-trip with key-aware spelling', () => {
  it('spells in C major (mostly naturals/sharps)', () => {
    expect(midiToPitch(60, major(p('C', 'natural', 4)))).toEqual(p('C', 'natural', 4));
    expect(midiToPitch(61, major(p('C', 'natural', 4)))).toEqual(p('C', 'sharp', 4));
  });

  it('spells flats in flat keys (F major -> Bb)', () => {
    expect(midiToPitch(58, major(p('F', 'natural', 4)))).toEqual(p('B', 'flat', 3));
  });

  it('round-trips across the guitar range MIDI 40-88 in several keys', () => {
    const keys: Key[] = [
      major(p('C', 'natural', 4)),
      major(p('G', 'natural', 4)),
      major(p('F', 'natural', 4)),
      major(p('D', 'natural', 4)),
      major(p('B', 'flat', 4)),
      major(p('E', 'natural', 4)),
      major(p('A', 'flat', 4)),
    ];
    for (const key of keys) {
      for (let midi = 40; midi <= 88; midi++) {
        const pitch = midiToPitch(midi, key);
        expect(pitchToMidi(pitch)).toBe(midi);
      }
    }
  });
});
