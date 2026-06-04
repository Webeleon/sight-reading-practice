import { describe, it, expect } from 'vitest';
import { getFallbackLine, loadFallbackLines } from './fallback.js';
import {
  validatePosition,
  validateMusicality,
} from './validators.js';
import { ticksPerBar, FOUR_FOUR } from '../domain/index.js';

const FIXED_AT = '2026-06-04T00:00:00.000Z';

describe('fallback lines', () => {
  it('there is at least one pre-authored fallback line', () => {
    expect(loadFallbackLines().length).toBeGreaterThan(0);
  });

  it('every fallback line fills each bar exactly and is position-valid', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    for (const line of loadFallbackLines()) {
      const perBar = new Map<number, number>();
      for (const n of line.notes) {
        perBar.set(n.barIndex, (perBar.get(n.barIndex) ?? 0) + n.duration.ticks);
      }
      for (let bar = 0; bar < line.barCount; bar++) {
        expect(perBar.get(bar)).toBe(tpb);
      }
      // They were generated cleanly, so re-validating must not throw.
      expect(() => validatePosition(line.notes, line.position)).not.toThrow();
      expect(() => validateMusicality(line.notes, line.contourTarget)).not.toThrow();
    }
  });

  it('getFallbackLine re-stamps seed + injected timestamp deterministically', () => {
    const a = getFallbackLine(4, 123, FIXED_AT);
    const b = getFallbackLine(4, 123, FIXED_AT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).toBe(123);
    expect(a.generatedAt).toBe(FIXED_AT);
    expect(a.validationsPassed).toContain('fallback');
  });

  it('matches a fallback to the requested bar count when available', () => {
    const two = getFallbackLine(2, 1, FIXED_AT);
    expect(two.barCount).toBe(2);
    const four = getFallbackLine(4, 1, FIXED_AT);
    expect(four.barCount).toBe(4);
  });
});
