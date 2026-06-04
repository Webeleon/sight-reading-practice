import { describe, it, expect } from 'vitest';
import { makeRng, randInt, pick, weightedPick, softmaxPick } from './prng.js';

describe('makeRng', () => {
  it('is deterministic for the same (seed, attempt)', () => {
    const a = makeRng(7, 0);
    const b = makeRng(7, 0);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('advances the sequence across attempts (retries differ)', () => {
    const a = makeRng(7, 0);
    const b = makeRng(7, 1);
    expect(a()).not.toBe(b());
  });
});

describe('pick / randInt', () => {
  it('randInt stays in [0, n)', () => {
    const rng = makeRng(1, 0);
    for (let i = 0; i < 100; i++) {
      const v = randInt(rng, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  it('pick throws on empty array', () => {
    expect(() => pick(makeRng(1, 0), [])).toThrow();
  });
});

describe('weightedPick', () => {
  it('never returns a zero-weight index', () => {
    const rng = makeRng(2, 0);
    const weights = [0, 5, 0, 3];
    for (let i = 0; i < 200; i++) {
      const idx = weightedPick(rng, weights);
      expect(weights[idx]).toBeGreaterThan(0);
    }
  });

  it('throws when all weights are non-positive', () => {
    expect(() => weightedPick(makeRng(1, 0), [0, -1, 0])).toThrow();
  });

  it('roughly respects the weight ratio', () => {
    const rng = makeRng(3, 0);
    const weights = [1, 9];
    let ones = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (weightedPick(rng, weights) === 1) ones++;
    }
    // index 1 should win ~90% of the time.
    expect(ones / N).toBeGreaterThan(0.8);
    expect(ones / N).toBeLessThan(0.97);
  });
});

describe('softmaxPick', () => {
  it('low temperature concentrates on the highest score', () => {
    const rng = makeRng(4, 0);
    const scores = [0, 1, 5];
    let top = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (softmaxPick(rng, scores, 0.1) === 2) top++;
    }
    expect(top / N).toBeGreaterThan(0.95);
  });

  it('is deterministic given the same rng stream', () => {
    const scores = [1, 2, 3, 2, 1];
    const a = makeRng(5, 0);
    const b = makeRng(5, 0);
    const seqA = Array.from({ length: 10 }, () => softmaxPick(a, scores, 0.7));
    const seqB = Array.from({ length: 10 }, () => softmaxPick(b, scores, 0.7));
    expect(seqA).toEqual(seqB);
  });
});
