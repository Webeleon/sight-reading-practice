import { describe, it, expect } from 'vitest';
import { FOUR_FOUR, ticksPerBar, durationToTicks } from '../domain/index.js';
import {
  loadMotifs,
  validateMotifs,
  MotifValidationError,
  type RhythmicMotifEntry,
} from './motifLibrary.js';

const BAR_4_4 = ticksPerBar(FOUR_FOUR); // 1920

describe('loadMotifs — valid starter library', () => {
  const motifs = loadMotifs();

  it('loads without throwing and returns at least 15 motifs', () => {
    expect(motifs.length).toBeGreaterThanOrEqual(15);
  });

  it('every motif has durations summing to exactly one 4/4 bar (1920 ticks)', () => {
    for (const m of motifs) {
      const sum = m.durations.reduce((acc, d) => acc + durationToTicks(d), 0);
      expect(sum, `motif ${m.id} must sum to ${BAR_4_4}`).toBe(BAR_4_4);
    }
  });

  it('every motif declares the 4/4 time signature', () => {
    for (const m of motifs) {
      expect(m.timeSignature).toBe('4/4');
    }
  });

  it('every motif has a non-empty id, name, and rhythmVocabulary', () => {
    for (const m of motifs) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(Array.isArray(m.rhythmVocabulary)).toBe(true);
    }
  });

  it('motif ids are unique', () => {
    const ids = motifs.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the required rhythm families from the brief', () => {
    const allVocab = new Set(motifs.flatMap((m) => m.rhythmVocabulary));
    // straight quarters / eighths, dotted, syncopation, triplet, sixteenth
    expect(allVocab).toContain('straight');
    expect(allVocab).toContain('dotted');
    expect(allVocab).toContain('syncopated');
    expect(allVocab).toContain('triplet');
    expect(allVocab).toContain('sixteenth');
  });

  it('includes the Charleston figure (dotted quarter 720 + eighth 240 + half 960)', () => {
    const charleston = motifs.find((m) => m.id === 'charleston');
    expect(charleston).toBeDefined();
    const ticks = charleston!.durations.map((d) => durationToTicks(d));
    expect(ticks).toEqual([720, 240, 960]);
  });

  it('includes a triplet bar', () => {
    const triplet = motifs.find((m) =>
      m.durations.some((d) => d.tuplet !== undefined),
    );
    expect(triplet).toBeDefined();
  });

  it('includes a sixteenth-note grouping', () => {
    const sixteenth = motifs.find((m) =>
      m.durations.some((d) => d.base === 'sixteenth'),
    );
    expect(sixteenth).toBeDefined();
  });
});

describe('validateMotifs — fails LOUDLY on a bad bar', () => {
  it('throws MotifValidationError when a motif does not sum to a full bar', () => {
    const bad: RhythmicMotifEntry[] = [
      {
        id: 'short-bar',
        name: 'too short',
        timeSignature: '4/4',
        difficulty: 1,
        // three quarters = 1440 ticks, NOT a full 1920 bar
        durations: [
          { base: 'quarter', dots: 0, ticks: 480 },
          { base: 'quarter', dots: 0, ticks: 480 },
          { base: 'quarter', dots: 0, ticks: 480 },
        ],
        rhythmVocabulary: ['straight'],
      },
    ];
    expect(() => validateMotifs(bad)).toThrow(MotifValidationError);
  });

  it('throws when a motif overflows the bar', () => {
    const bad: RhythmicMotifEntry[] = [
      {
        id: 'long-bar',
        name: 'too long',
        timeSignature: '4/4',
        difficulty: 1,
        durations: [
          { base: 'whole', dots: 0, ticks: 1920 },
          { base: 'quarter', dots: 0, ticks: 480 },
        ],
        rhythmVocabulary: ['straight'],
      },
    ];
    expect(() => validateMotifs(bad)).toThrow(/sum/i);
  });
});
