import { describe, it, expect } from 'vitest';
import { generateLine, GENERATOR_VERSION } from './generateLine.js';
import type { LineConfig } from './config.js';
import {
  FOUR_FOUR,
  makeNeckPosition,
  ticksPerBar,
  pitchToMidi,
  pitchClass,
} from '../domain/index.js';
import type { Key } from '../domain/index.js';
import { isPlayableInPosition } from '../fretboard/index.js';

const FIXED_AT = '2026-06-04T12:00:00.000Z';

const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
const aMinor: Key = { tonic: { name: 'A', accidental: 'natural' }, mode: 'minor' };

function config(overrides: Partial<LineConfig> = {}): LineConfig {
  return {
    key: cMajor,
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo: 90,
    barCount: 4,
    difficulty: 3,
    accidentalsDensity: 'none',
    ...overrides,
  };
}

describe('generateLine — determinism', () => {
  it('yields byte-identical JSON for the same (config, seed, generatedAt)', () => {
    const cfg = config();
    const a = JSON.stringify(generateLine(cfg, 42, FIXED_AT));
    const b = JSON.stringify(generateLine(cfg, 42, FIXED_AT));
    expect(a).toBe(b);
  });

  it('different seeds generally produce different lines', () => {
    const cfg = config();
    const a = JSON.stringify(generateLine(cfg, 1, FIXED_AT).notes);
    const b = JSON.stringify(generateLine(cfg, 2, FIXED_AT).notes);
    expect(a).not.toBe(b);
  });

  it('uses the injected generatedAt verbatim (never the system clock)', () => {
    const line = generateLine(config(), 7, FIXED_AT);
    expect(line.generatedAt).toBe(FIXED_AT);
  });

  it('stamps the seed and generator version onto the line', () => {
    const line = generateLine(config(), 99, FIXED_AT);
    expect(line.seed).toBe(99);
    expect(line.generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('derives a stable id from (config, seed)', () => {
    const cfg = config();
    expect(generateLine(cfg, 5, FIXED_AT).id).toBe(
      generateLine(cfg, 5, FIXED_AT).id,
    );
    // Different seed -> different id.
    expect(generateLine(cfg, 5, FIXED_AT).id).not.toBe(
      generateLine(cfg, 6, FIXED_AT).id,
    );
  });
});

describe('generateLine — rhythm fills each bar exactly', () => {
  it('every bar of every line sums to exactly ticksPerBar', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    for (const bc of [2, 3, 4, 6]) {
      for (let seed = 0; seed < 25; seed++) {
        const line = generateLine(config({ barCount: bc }), seed, FIXED_AT);
        const perBar = new Map<number, number>();
        for (const n of line.notes) {
          perBar.set(n.barIndex, (perBar.get(n.barIndex) ?? 0) + n.duration.ticks);
        }
        expect(perBar.size).toBe(bc);
        for (let bar = 0; bar < bc; bar++) {
          expect(perBar.get(bar)).toBe(tpb);
        }
      }
    }
  });

  it('note start ticks are contiguous and ascending within the line', () => {
    const line = generateLine(config(), 3, FIXED_AT);
    let expected = 0;
    for (const n of line.notes) {
      expect(n.startTick).toBe(expected);
      expected += n.duration.ticks;
    }
    expect(expected).toBe(ticksPerBar(FOUR_FOUR) * line.barCount);
  });
});

describe('generateLine — position invariant', () => {
  it('every sounding note is playable in the declared position', () => {
    const positions = [
      makeNeckPosition(1, 6, 0, 4, 'open'),
      makeNeckPosition(1, 6, 4, 8, 'V'),
      makeNeckPosition(1, 6, 7, 11, 'VIII'),
    ];
    for (const pos of positions) {
      for (let seed = 0; seed < 30; seed++) {
        const line = generateLine(config({ position: pos }), seed, FIXED_AT);
        for (const n of line.notes) {
          if (n.pitch === null) continue;
          expect(isPlayableInPosition(n.pitch, pos)).toBe(true);
        }
      }
    }
  });
});

describe('generateLine — cadence invariant', () => {
  it('lines end on a tonic pitch class for an authentic-friendly major key', () => {
    // C major; the final note should land on a cadence target (tonic 0, or for half
    // cadences the dominant 7, or plagal/other targets). Assert it is one of the
    // cadence "to" roles' pitch classes: tonic(0), mediant(4), dominant(7).
    const allowed = new Set([0, 4, 7]);
    for (let seed = 0; seed < 40; seed++) {
      const line = generateLine(config(), seed, FIXED_AT);
      const sounding = line.notes.filter((n) => n.pitch !== null);
      const last = sounding[sounding.length - 1]!.pitch!;
      expect(allowed.has(pitchClass(last))).toBe(true);
    }
  });

  it('works for a minor key too', () => {
    const line = generateLine(config({ key: aMinor }), 11, FIXED_AT);
    expect(line.notes.length).toBeGreaterThan(0);
    expect(line.validationsPassed).toContain('validateCadence');
  });
});

describe('generateLine — total range stays within ~1.5 octaves', () => {
  it('no generated (non-fallback) line spans more than 19 semitones', () => {
    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const line = generateLine(config(), seed, FIXED_AT);
      if (line.validationsPassed.includes('fallback')) continue;
      const midis = line.notes
        .filter((n) => n.pitch !== null)
        .map((n) => pitchToMidi(n.pitch!));
      const range = Math.max(...midis) - Math.min(...midis);
      expect(range).toBeLessThanOrEqual(19);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
