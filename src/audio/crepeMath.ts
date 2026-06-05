// crepeMath.ts — PURE CREPE framing + post-processing math.
//
// IMPORTANT: like pitchMath.ts / onsetSegmenter.ts this file lives under src/audio
// (tsconfig.ui, so DOM/WebAudio globals are technically available) but uses NONE
// of them, and — critically — does NOT import tfjs. It is plain arithmetic over
// Float32Array / number[], so the framing, normalization, resampling, and the
// bin -> cents -> Hz + weighted-argmax post-processing are unit-testable in the
// vitest NODE environment and reusable by the offline validation script. The
// tfjs forward pass (the only impure part) stays in crepeDetector.ts.
//
// No `any`. No I/O. No globals. No tfjs.

/** CREPE operates on 16 kHz mono audio. The device input is resampled to this. */
export const CREPE_SAMPLE_RATE = 16000;

/** CREPE consumes 1024-sample windows; the model input shape is [n, 1024]. */
export const CREPE_FRAME_SIZE = 1024;

/** The model emits a 360-bin activation over pitch (one sigmoid per bin). */
export const CREPE_PITCH_BINS = 360;

/**
 * The constant mapping a CREPE pitch BIN index to CENTS. CREPE's 360 bins span
 * 20-cent steps starting at this offset, i.e. cents(bin) = 20*bin + 1997.379...
 * Bin 0 ~= 32.70 Hz (C1), bin 359 ~= 1975.5 Hz (B6) — comfortably bracketing the
 * guitar range. This constant is from the reference CREPE implementation.
 */
export const CREPE_CENTS_OFFSET = 1997.3794084376191;

/** Cents per CREPE bin (the bin spacing). */
export const CREPE_CENTS_PER_BIN = 20;

/**
 * How many bins on EITHER side of the argmax to include in the local weighted
 * average (the centroid) when refining the predicted cents. CREPE's reference
 * uses a small window around the peak so the estimate is sub-bin accurate without
 * being pulled by far-off spurious activations. +/-4 bins == an 8-bin (160-cent)
 * window.
 */
export const CREPE_LOCAL_AVERAGE_RADIUS = 4;

/** Cents of a pitch bin index: cents = 20*bin + 1997.3794084376191. */
export function binToCents(bin: number): number {
  return CREPE_CENTS_PER_BIN * bin + CREPE_CENTS_OFFSET;
}

/** Hz of a cents value: freq = 10 * 2^(cents/1200). (CREPE's reference base.) */
export function centsToHz(cents: number): number {
  return 10 * Math.pow(2, cents / 1200);
}

/** Convenience: Hz of a (whole) pitch bin index. */
export function binToHz(bin: number): number {
  return centsToHz(binToCents(bin));
}

/**
 * Per-frame normalization CREPE expects: subtract the mean, divide by the
 * standard deviation. A (near-)silent / constant frame has ~zero std; we guard
 * against divide-by-zero by returning the mean-subtracted frame (all ~zeros) so
 * the model sees silence rather than NaNs. Returns a NEW Float32Array.
 */
export function normalizeFrame(frame: Float32Array): Float32Array {
  const n = frame.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i] ?? 0;
  mean /= n || 1;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = (frame[i] ?? 0) - mean;
    variance += d * d;
  }
  variance /= n || 1;
  const std = Math.sqrt(variance);
  const out = new Float32Array(n);
  if (std < 1e-8) {
    // Constant/silent frame: mean-subtracted is all zeros; leave as zeros.
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = ((frame[i] ?? 0) - mean) / std;
  return out;
}

/**
 * Resample `input` (at `fromRate` Hz) to `outLength` samples at `toRate` Hz using
 * linear interpolation. We map the OUTPUT length to the corresponding span of the
 * input so a full `outLength`-sample window at `toRate` is produced from the input
 * window. When the input is shorter than required the tail is clamped to the last
 * sample (silence-padded in practice). Linear interpolation is intentionally
 * cheap — for a clean monophonic note feeding a CNN pitch tracker it is more than
 * adequate, and audio latency/quality at this stage is out of scope (brief 2).
 *
 * @param input      device-rate time-domain samples.
 * @param fromRate   the input sample rate (Hz), e.g. 44100 / 48000.
 * @param toRate     the target sample rate (Hz), e.g. CREPE_SAMPLE_RATE.
 * @param outLength  number of output samples to produce (e.g. CREPE_FRAME_SIZE).
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
  outLength: number,
): Float32Array {
  const out = new Float32Array(outLength);
  if (input.length === 0) return out;
  if (fromRate === toRate && input.length >= outLength) {
    // Same rate: take the first outLength samples directly (no interpolation).
    out.set(input.subarray(0, outLength));
    return out;
  }
  const ratio = fromRate / toRate; // input samples advanced per output sample
  const lastIdx = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    if (i0 >= lastIdx) {
      out[i] = input[lastIdx] ?? 0;
      continue;
    }
    const frac = srcPos - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** The refined pitch estimate for one CREPE activation frame. */
export interface CrepeFramePitch {
  /** Estimated fundamental in Hz (0 when the activation is degenerate). */
  frequencyHz: number;
  /** Peak activation in [0,1] — the detector confidence / clarity. */
  confidence: number;
  /** The argmax bin (for debugging / tests). */
  peakBin: number;
}

/**
 * Convert one 360-bin CREPE activation frame to a refined pitch. Steps (matching
 * the reference CREPE post-processing):
 *   1. argmax over the activation -> peak bin; peak value -> confidence/clarity.
 *   2. take a local window (+/- CREPE_LOCAL_AVERAGE_RADIUS bins) around the peak,
 *   3. compute the activation-weighted average of the bins' CENTS (a centroid),
 *      which gives a sub-bin, smooth estimate robust to the 20-cent quantization,
 *   4. convert the weighted-average cents to Hz.
 * The local average (vs argmax alone) is what makes CREPE land within a few cents
 * of the true pitch instead of snapping to the nearest 20-cent bin.
 *
 * @param activation  a length-360 (or compatible) activation array in [0,1].
 */
export function framePitchFromActivation(
  activation: ArrayLike<number>,
): CrepeFramePitch {
  const n = activation.length;
  if (n === 0) return { frequencyHz: 0, confidence: 0, peakBin: 0 };

  // 1. argmax + peak value.
  let peakBin = 0;
  let peakVal = activation[0] ?? 0;
  for (let i = 1; i < n; i++) {
    const v = activation[i] ?? 0;
    if (v > peakVal) {
      peakVal = v;
      peakBin = i;
    }
  }

  // 2-3. local activation-weighted average of cents around the peak.
  const lo = Math.max(0, peakBin - CREPE_LOCAL_AVERAGE_RADIUS);
  const hi = Math.min(n - 1, peakBin + CREPE_LOCAL_AVERAGE_RADIUS);
  let weightedCents = 0;
  let weightSum = 0;
  for (let b = lo; b <= hi; b++) {
    const w = activation[b] ?? 0;
    weightedCents += w * binToCents(b);
    weightSum += w;
  }
  if (weightSum <= 0) {
    // Degenerate (all-zero window): fall back to the peak bin's cents.
    return {
      frequencyHz: centsToHz(binToCents(peakBin)),
      confidence: peakVal,
      peakBin,
    };
  }
  const cents = weightedCents / weightSum;

  // 4. cents -> Hz.
  return { frequencyHz: centsToHz(cents), confidence: peakVal, peakBin };
}
