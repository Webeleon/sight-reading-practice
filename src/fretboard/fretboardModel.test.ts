import { describe, it, expect } from 'vitest';
import {
  MAX_FRET,
  midiAt,
  pitchClassAt,
  buildFretboardModel,
} from './fretboardModel.js';

describe('fretboard model (string 1 = low E, string 6 = high E)', () => {
  it('open strings sound the tuning MIDI numbers', () => {
    expect(midiAt(1, 0)).toBe(40); // low E
    expect(midiAt(2, 0)).toBe(45); // A
    expect(midiAt(3, 0)).toBe(50); // D
    expect(midiAt(4, 0)).toBe(55); // G
    expect(midiAt(5, 0)).toBe(59); // B
    expect(midiAt(6, 0)).toBe(64); // high E
  });

  it('each fret adds one semitone', () => {
    expect(midiAt(1, 5)).toBe(45); // low E + 5 frets = A
    expect(midiAt(6, 1)).toBe(65); // high E + 1 = F5
  });

  it('string 4 fret 5 = C4 (middle C, MIDI 60)', () => {
    expect(midiAt(4, 5)).toBe(60);
  });

  it('reports pitch class 0-11', () => {
    expect(pitchClassAt(4, 5)).toBe(0); // C
    expect(pitchClassAt(1, 0)).toBe(4); // E
  });

  it('builds 6 strings * (MAX_FRET + 1) cells', () => {
    const cells = buildFretboardModel();
    expect(cells).toHaveLength(6 * (MAX_FRET + 1));
    // first cell is string 1 fret 0 (low E open)
    expect(cells[0]).toEqual({ string: 1, fret: 0, midi: 40, pitchClass: 4 });
  });

  it('rejects frets outside 0..MAX_FRET', () => {
    expect(() => midiAt(1, -1)).toThrow();
    expect(() => midiAt(1, MAX_FRET + 1)).toThrow();
  });
});
