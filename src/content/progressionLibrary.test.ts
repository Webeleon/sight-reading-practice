import { describe, it, expect } from 'vitest';
import {
  loadProgressions,
  validateProgressions,
} from './progressionLibrary.js';
import type { ProgressionEntry } from './progressionLibrary.js';

describe('loadProgressions', () => {
  const progressions = loadProgressions();

  it('loads the starter progressions JSON without throwing', () => {
    expect(progressions.length).toBeGreaterThanOrEqual(12);
  });

  it('covers 2-bar and 4-bar lengths', () => {
    const barCounts = new Set(progressions.map((p) => p.barCount));
    expect(barCounts.has(2)).toBe(true);
    expect(barCounts.has(4)).toBe(true);
  });

  it('covers difficulties 1 through 3', () => {
    const diffs = new Set(progressions.map((p) => p.difficulty));
    expect(diffs.has(1)).toBe(true);
    expect(diffs.has(2)).toBe(true);
    expect(diffs.has(3)).toBe(true);
  });

  it('includes the brief-required named progressions', () => {
    const ids = new Set(progressions.map((p) => p.id));
    // brief section 8: I-IV-V-I, I-vi-IV-V, ii-V-I, I-V-vi-IV,
    // a 4-bar blues fragment, a I-vi-ii-V turnaround.
    expect(ids.has('I-IV-V-I')).toBe(true);
    expect(ids.has('I-vi-IV-V')).toBe(true);
    expect(ids.has('ii-V-I')).toBe(true);
    expect(ids.has('I-V-vi-IV')).toBe(true);
    expect(ids.has('blues-4bar')).toBe(true);
    expect(ids.has('I-vi-ii-V')).toBe(true);
  });

  it('has unique ids', () => {
    const ids = progressions.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every chord barIndex is within [0, barCount)', () => {
    for (const prog of progressions) {
      for (const chord of prog.chords) {
        expect(chord.barIndex).toBeGreaterThanOrEqual(0);
        expect(chord.barIndex).toBeLessThan(prog.barCount);
      }
    }
  });
});

describe('validateProgressions (deliberately broken fixtures throw)', () => {
  const good = (): ProgressionEntry => ({
    id: 'test-good',
    name: 'Test Good',
    difficulty: 1,
    barCount: 2,
    chords: [
      { romanNumeral: 'I', quality: 'major', barIndex: 0, startTick: 0 },
      { romanNumeral: 'V7', quality: 'dominant7', barIndex: 1, startTick: 0 },
    ],
    tags: ['diatonic'],
    applicableKeys: 'all',
  });

  it('accepts a valid fixture', () => {
    expect(() => validateProgressions([good()])).not.toThrow();
  });

  it('throws on barIndex out of range (>= barCount)', () => {
    const bad = good();
    bad.chords[1]!.barIndex = 2; // barCount is 2 -> valid indices are 0,1
    expect(() => validateProgressions([bad])).toThrow();
  });

  it('throws on negative barIndex', () => {
    const bad = good();
    bad.chords[0]!.barIndex = -1;
    expect(() => validateProgressions([bad])).toThrow();
  });

  it('throws on an unparseable Roman numeral', () => {
    const bad = good();
    bad.chords[0]!.romanNumeral = 'Q';
    expect(() => validateProgressions([bad])).toThrow();
  });

  it('throws on an invalid quality enum', () => {
    const bad = good();
    // deliberately not a TriadQuality | SeventhQuality
    (bad.chords[0] as { quality: string }).quality = 'power5';
    expect(() => validateProgressions([bad])).toThrow();
  });

  it('throws on an invalid difficulty', () => {
    const bad = good();
    (bad as { difficulty: number }).difficulty = 6;
    expect(() => validateProgressions([bad])).toThrow();
  });

  it('throws on duplicate ids', () => {
    expect(() => validateProgressions([good(), good()])).toThrow();
  });

  it('throws when no chord is in the final bar (incomplete coverage)', () => {
    const bad = good();
    bad.chords = [
      { romanNumeral: 'I', quality: 'major', barIndex: 0, startTick: 0 },
    ];
    expect(() => validateProgressions([bad])).toThrow();
  });
});
