// crepeMath.test.ts — node unit tests for the PURE CREPE framing/post-process math.
// No tfjs, no DOM: this exercises the bin->cents->Hz mapping, per-frame
// normalization, linear resampling, and the weighted-argmax pitch estimate with
// FAKE activations (a synthetic peak), so the math is validated independently of
// the model. The model-inference accuracy check lives in scripts/_verify_crepe.ts.

import { describe, it, expect } from 'vitest';
import {
  CREPE_FRAME_SIZE,
  CREPE_PITCH_BINS,
  CREPE_SAMPLE_RATE,
  binToCents,
  centsToHz,
  binToHz,
  normalizeFrame,
  resampleLinear,
  framePitchFromActivation,
} from './crepeMath.js';
import { frequencyToMidi } from './pitchMath.js';

/** The cents value of a target frequency, for placing a synthetic activation peak
 *  at the right bin. Inverse of centsToHz: cents = 1200 * log2(freq/10). */
function hzToCents(freq: number): number {
  return 1200 * Math.log2(freq / 10);
}

/** The (fractional) CREPE bin index of a frequency: bin = (cents - offset)/20. */
function hzToBin(freq: number): number {
  return (hzToCents(freq) - binToCents(0)) / 20;
}

/** A synthetic 360-bin activation with a Gaussian bump centred on `centerBin`,
 *  peak amplitude `peak` — mimics what the model emits for a clean tone. */
function gaussianActivation(centerBin: number, peak = 0.95, sigma = 1.5): Float32Array {
  const a = new Float32Array(CREPE_PITCH_BINS);
  for (let b = 0; b < CREPE_PITCH_BINS; b++) {
    const d = b - centerBin;
    a[b] = peak * Math.exp(-(d * d) / (2 * sigma * sigma));
  }
  return a;
}

describe('crepeMath bin <-> cents <-> Hz', () => {
  it('uses the brief-specified bin->cents constant', () => {
    expect(binToCents(0)).toBeCloseTo(1997.3794084376191, 6);
    expect(binToCents(1)).toBeCloseTo(1997.3794084376191 + 20, 6);
    expect(binToCents(10)).toBeCloseTo(1997.3794084376191 + 200, 6);
  });

  it('centsToHz uses freq = 10 * 2^(cents/1200)', () => {
    expect(centsToHz(0)).toBeCloseTo(10, 9);
    expect(centsToHz(1200)).toBeCloseTo(20, 9); // one octave up from 10 Hz
  });

  it('binToHz round-trips through hzToBin for guitar-range pitches', () => {
    for (const f of [82.41, 110, 146.83, 220, 440, 880]) {
      const bin = hzToBin(f);
      expect(binToHz(bin)).toBeCloseTo(f, 4);
    }
  });

  it('bin 0 ~= 31.7 Hz (just below C1) and the top bin brackets the guitar range', () => {
    // The brief's constant puts bin 0 at ~31.70 Hz (a hair below C1's 32.703 Hz);
    // bin 359 lands well above the guitar's top so the whole range is covered.
    expect(binToHz(0)).toBeCloseTo(31.7, 1);
    expect(binToHz(CREPE_PITCH_BINS - 1)).toBeGreaterThan(1900); // ~B6
    expect(binToHz(CREPE_PITCH_BINS - 1)).toBeLessThan(2100);
  });
});

describe('normalizeFrame', () => {
  it('produces zero mean and unit std for a non-constant frame', () => {
    const frame = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = normalizeFrame(frame);
    let mean = 0;
    for (const v of out) mean += v;
    mean /= out.length;
    let varr = 0;
    for (const v of out) varr += (v - mean) * (v - mean);
    varr /= out.length;
    expect(mean).toBeCloseTo(0, 6);
    expect(Math.sqrt(varr)).toBeCloseTo(1, 6);
  });

  it('returns all zeros for a constant/silent frame (no divide-by-zero NaN)', () => {
    const out = normalizeFrame(new Float32Array([0.3, 0.3, 0.3, 0.3]));
    for (const v of out) expect(v).toBe(0);
  });
});

describe('resampleLinear', () => {
  it('preserves a 16kHz sine wave shape (same-rate path)', () => {
    const N = CREPE_FRAME_SIZE;
    const src = new Float32Array(N);
    for (let i = 0; i < N; i++) src[i] = Math.sin((2 * Math.PI * 440 * i) / CREPE_SAMPLE_RATE);
    const out = resampleLinear(src, CREPE_SAMPLE_RATE, CREPE_SAMPLE_RATE, N);
    expect(out.length).toBe(N);
    for (let i = 0; i < N; i++) expect(out[i]).toBeCloseTo(src[i] ?? 0, 6);
  });

  it('downsamples a 48kHz sine to a 16kHz frame of the right length + frequency', () => {
    // 3072 samples @48k == 64ms; resampled to 1024 @16k == same 64ms span.
    const inN = 3072;
    const fromRate = 48000;
    const src = new Float32Array(inN);
    for (let i = 0; i < inN; i++) src[i] = Math.sin((2 * Math.PI * 220 * i) / fromRate);
    const out = resampleLinear(src, fromRate, CREPE_SAMPLE_RATE, CREPE_FRAME_SIZE);
    expect(out.length).toBe(CREPE_FRAME_SIZE);
    // Count zero-crossings to confirm the frequency survived resampling: a 220Hz
    // tone over 64ms has ~28 half-cycles (220*0.064*2 ~= 28).
    let crossings = 0;
    for (let i = 1; i < out.length; i++) {
      if ((out[i - 1] ?? 0) <= 0 && (out[i] ?? 0) > 0) crossings++;
    }
    // ~14 full periods over the window (220 * 0.064 ~= 14).
    expect(crossings).toBeGreaterThanOrEqual(12);
    expect(crossings).toBeLessThanOrEqual(16);
  });
});

describe('framePitchFromActivation (fake activations)', () => {
  it('recovers the peak bin and confidence from a Gaussian bump', () => {
    const act = gaussianActivation(180, 0.9);
    const { peakBin, confidence } = framePitchFromActivation(act);
    expect(peakBin).toBe(180);
    expect(confidence).toBeCloseTo(0.9, 6);
  });

  it('recovers known guitar pitches within a few cents (and NOT octave-shifted)', () => {
    // For each target Hz, place a Gaussian peak at its exact (fractional) bin and
    // assert the weighted-average estimate lands within ~5 cents, same octave.
    for (const target of [82.41, 110, 146.83, 196, 220, 329.63, 440, 880]) {
      const centerBin = hzToBin(target);
      const act = gaussianActivation(centerBin, 0.95, 1.5);
      const { frequencyHz } = framePitchFromActivation(act);
      const cents = 1200 * Math.log2(frequencyHz / target);
      expect(Math.abs(cents)).toBeLessThan(6); // within a few cents
      // Same MIDI note (no octave error).
      expect(frequencyToMidi(frequencyHz)).toBe(frequencyToMidi(target));
    }
  });

  it('is sub-bin accurate: a peak halfway between two bins reads the midpoint cents', () => {
    // center at bin 100.5 -> expect cents ~= midpoint of bin 100 and 101 cents.
    const act = gaussianActivation(100.5, 0.9, 1.5);
    const { frequencyHz } = framePitchFromActivation(act);
    const cents = 1200 * Math.log2(frequencyHz / 10);
    const mid = (binToCents(100) + binToCents(101)) / 2;
    expect(Math.abs(cents - mid)).toBeLessThan(3);
  });

  it('handles an all-zero activation without NaN', () => {
    const { frequencyHz, confidence } = framePitchFromActivation(
      new Float32Array(CREPE_PITCH_BINS),
    );
    expect(confidence).toBe(0);
    expect(Number.isFinite(frequencyHz)).toBe(true);
  });
});
