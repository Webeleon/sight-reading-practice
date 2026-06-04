import { describe, it, expect } from 'vitest';
import { makeNeckPosition, midiToPitch, prettyPitch } from '../domain/index.js';
import type { Key } from '../domain/index.js';
import {
  computePlayablePitches,
  isPlayableInPosition,
} from './positionMapping.js';

// 5th position: frets 4-8 inclusive, all 6 strings (1 = low E ... 6 = high E).
const FIFTH_POSITION = makeNeckPosition(1, 6, 4, 8, 'V');

describe('computePlayablePitches — 5th position (frets 4-8), all strings', () => {
  const pitches = computePlayablePitches(FIFTH_POSITION);

  it('returns 29 distinct pitches, contiguous MIDI 44..72', () => {
    const midis = pitches.map((p) => p.midi);
    expect(midis).toHaveLength(29);
    // strictly ascending, no gaps, from 44 (low E fret 4 = G#2) to 72 (high E fret 8)
    expect(midis[0]).toBe(44);
    expect(midis[midis.length - 1]).toBe(72);
    expect(midis).toEqual(Array.from({ length: 29 }, (_, i) => 44 + i));
  });

  it('exposes pitch class for each pitch', () => {
    const c4 = pitches.find((p) => p.midi === 60);
    expect(c4?.pitchClass).toBe(0); // C
  });

  it('annotates each pitch with valid string/fret options that actually sound it', () => {
    const open: ReadonlyArray<number> = [40, 45, 50, 55, 59, 64];
    for (const p of pitches) {
      expect(p.stringFretOptions.length).toBeGreaterThan(0);
      for (const { string, fret } of p.stringFretOptions) {
        expect(string).toBeGreaterThanOrEqual(1);
        expect(string).toBeLessThanOrEqual(6);
        expect(fret).toBeGreaterThanOrEqual(4);
        expect(fret).toBeLessThanOrEqual(8);
        expect(open[string - 1]! + fret).toBe(p.midi);
      }
    }
  });

  it('lists multiple fingerings where the same pitch is reachable on two strings', () => {
    // G4 = MIDI 67? no: G4 = 67. Within 4-8: MIDI 63 (Eb4/D#4) is on string 4 fret 8
    // AND string 5 fret 4. That overlap is the unison guitarists know.
    const dup = computePlayablePitches(FIFTH_POSITION).find((p) => p.midi === 63);
    expect(dup?.stringFretOptions).toEqual([
      { string: 4, fret: 8 },
      { string: 5, fret: 4 },
    ]);
  });

  it('options are sorted by string then fret; pitches ascending by MIDI', () => {
    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i]!.midi).toBeGreaterThan(pitches[i - 1]!.midi);
    }
    const dup = pitches.find((p) => p.stringFretOptions.length > 1)!;
    const opts = dup.stringFretOptions;
    for (let i = 1; i < opts.length; i++) {
      const prev = opts[i - 1]!;
      const cur = opts[i]!;
      const ord =
        cur.string !== prev.string
          ? cur.string - prev.string
          : cur.fret - prev.fret;
      expect(ord).toBeGreaterThan(0);
    }
  });

  it('caller can spell the unspelled pitches against a key (C major)', () => {
    const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
    const c4 = pitches.find((p) => p.midi === 60)!;
    expect(prettyPitch(midiToPitch(c4.midi, cMajor))).toBe('C4');
  });
});

describe('computePlayablePitches — stringSubset restriction', () => {
  it('restricts to the given strings only', () => {
    // Only the two high strings (5 = B, 6 = high E).
    const pitches = computePlayablePitches(FIFTH_POSITION, [5, 6]);
    for (const p of pitches) {
      for (const o of p.stringFretOptions) {
        expect([5, 6]).toContain(o.string);
      }
    }
    // string 5 frets 4-8 -> MIDI 63..67; string 6 -> 68..72. Union = 63..72 = 10 pitches.
    expect(pitches.map((p) => p.midi)).toEqual(
      Array.from({ length: 10 }, (_, i) => 63 + i),
    );
  });
});

describe('isPlayableInPosition agrees with computePlayablePitches', () => {
  it('is true for every MIDI returned by computePlayablePitches and false otherwise', () => {
    const playable = new Set(
      computePlayablePitches(FIFTH_POSITION).map((p) => p.midi),
    );
    // Sweep the whole guitar range and check exact agreement.
    for (let midi = 30; midi <= 90; midi++) {
      expect(isPlayableInPosition(midi, FIFTH_POSITION)).toBe(
        playable.has(midi),
      );
    }
  });

  it('accepts a spelled Pitch and matches by sounding MIDI (enharmonic-agnostic)', () => {
    // D#4 and Eb4 both sound MIDI 63, which is playable in 5th position.
    expect(
      isPlayableInPosition(
        { name: 'D', accidental: 'sharp', octave: 4 },
        FIFTH_POSITION,
      ),
    ).toBe(true);
    expect(
      isPlayableInPosition(
        { name: 'E', accidental: 'flat', octave: 4 },
        FIFTH_POSITION,
      ),
    ).toBe(true);
  });

  it('respects stringSubset', () => {
    // MIDI 44 (low E fret 4) is only on string 1; excluded if we restrict to 5,6.
    expect(isPlayableInPosition(44, FIFTH_POSITION)).toBe(true);
    expect(isPlayableInPosition(44, FIFTH_POSITION, [5, 6])).toBe(false);
  });

  it('returns false for pitches outside the fret range', () => {
    // Open low E (MIDI 40) is fret 0 — outside frets 4-8.
    expect(isPlayableInPosition(40, FIFTH_POSITION)).toBe(false);
  });
});
