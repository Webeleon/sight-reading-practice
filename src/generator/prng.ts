// Seeded PRNG helpers threaded through every generator stage.
//
// ONE seedrandom instance is created per generateLine() call (seeded from the numeric
// seed) and passed by reference through all stages, so the entire line is a pure
// function of (config, seed). The global pseudo-random source is BANNED in this module
// set (grep-enforced); seedrandom is the only randomness the generator may use.
//
// Pure module: no electron/react/DOM, no `any`.

import seedrandom from 'seedrandom';

/** The threaded PRNG: call it to get a float in [0, 1). */
export type Rng = () => number;

/** Create a deterministic PRNG from a numeric seed and an attempt counter. The attempt
 *  is folded into the seed string so each outer retry produces a DIFFERENT sequence
 *  (brief section 9: "retry from the top with the RNG advanced"), while a given
 *  (seed, attempt) pair is always reproducible. */
export function makeRng(seed: number, attempt: number): Rng {
  return seedrandom(`${seed}:${attempt}`);
}

/** Uniform integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick a uniformly-random element. Throws on an empty array (a content/logic bug we
 *  want to surface loudly, not paper over). */
export function pick<T>(rng: Rng, items: ReadonlyArray<T>): T {
  if (items.length === 0) {
    throw new Error('[GEN] pick() called on an empty array');
  }
  return items[randInt(rng, items.length)]!;
}

/** Weighted choice: pick index i with probability weights[i] / sum(weights). Negative
 *  weights are clamped to 0. Throws if all weights are non-positive. */
export function weightedPick(rng: Rng, weights: ReadonlyArray<number>): number {
  let total = 0;
  for (const w of weights) {
    if (w > 0) total += w;
  }
  if (total <= 0) {
    throw new Error('[GEN] weightedPick(): all weights non-positive');
  }
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w > 0) {
      r -= w;
      if (r < 0) return i;
    }
  }
  // Floating-point fallthrough: return the last positive-weight index.
  for (let i = weights.length - 1; i >= 0; i--) {
    if (weights[i]! > 0) return i;
  }
  throw new Error('[GEN] weightedPick(): unreachable');
}

/** Softmax sample over raw scores with a temperature. Temperature -> 0 approaches
 *  argmax; larger flattens toward uniform. Returns the chosen index. */
export function softmaxPick(
  rng: Rng,
  scores: ReadonlyArray<number>,
  temperature: number,
): number {
  if (scores.length === 0) {
    throw new Error('[GEN] softmaxPick() called on an empty array');
  }
  const t = temperature <= 0 ? 1e-6 : temperature;
  // Subtract the max for numerical stability before exponentiating.
  let max = -Infinity;
  for (const s of scores) {
    if (s > max) max = s;
  }
  const weights = scores.map((s) => Math.exp((s - max) / t));
  return weightedPick(rng, weights);
}
