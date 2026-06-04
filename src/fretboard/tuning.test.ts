import { describe, it, expect } from 'vitest';
import { OPEN_STRING_MIDI, STRING_NUMBERS, openStringMidi } from './tuning.js';

describe('standard tuning (INVERTED numbering: string 1 = low E, string 6 = high E)', () => {
  it('open strings are E A D G B E = MIDI 40,45,50,55,59,64', () => {
    expect(OPEN_STRING_MIDI).toEqual([40, 45, 50, 55, 59, 64]);
  });

  it('string 1 is low E (MIDI 40) and string 6 is high E (MIDI 64)', () => {
    expect(openStringMidi(1)).toBe(40);
    expect(openStringMidi(6)).toBe(64);
  });

  it('exposes string numbers 1..6', () => {
    expect(STRING_NUMBERS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('throws on out-of-range string numbers', () => {
    expect(() => openStringMidi(0)).toThrow();
    expect(() => openStringMidi(7)).toThrow();
  });
});
