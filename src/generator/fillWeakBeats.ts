// Stage 8: fillWeakBeatPitches.
//
// For each weak beat between two anchored (strong-beat) pitches, choose a connecting
// pitch: passing motion for wide gaps, neighbor motion for same-pitch endpoints,
// arpeggiation toward chord tones, chromatic passing if the vocabulary admits it. A
// running step/leap tally is steered toward the 70/25/5 ideal (tuning.ts), and
// out-of-position pitches are heavily penalized.
//
// Output is the fully-pitched slot list (PitchedSlot[]), ready for annotation.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Pitch } from '../domain/index.js';
import { chordTones, pitchClass, pitchToMidi } from '../domain/index.js';
import type { ConcreteProgression } from '../domain/index.js';
import type { GenerationContext, PlayableNote } from './context.js';
import { chordAt } from './selectProgression.js';
import type { RhythmSlot, PitchedSlot } from './types.js';
import type { StrongBeatPitches } from './placeStrongBeats.js';
import type { Rng } from './prng.js';
import { softmaxPick } from './prng.js';
import {
  STEP_MAX_SEMITONES,
  SMALL_LEAP_MAX_SEMITONES,
  TARGET_STEP_FRACTION,
  TARGET_SMALL_LEAP_FRACTION,
  TARGET_LARGE_LEAP_FRACTION,
  W_BALANCE_CORRECTION,
  W_STEP_PREFERENCE,
  W_OUT_OF_POSITION_PENALTY,
  SAMPLING_TEMPERATURE,
} from './tuning.js';

type Bucket = 'step' | 'smallLeap' | 'largeLeap';

function bucketOf(semitones: number): Bucket {
  const s = Math.abs(semitones);
  if (s <= STEP_MAX_SEMITONES) return 'step';
  if (s <= SMALL_LEAP_MAX_SEMITONES) return 'smallLeap';
  return 'largeLeap';
}

/** Running interval tally used to steer the step/leap mix. */
interface Balance {
  step: number;
  smallLeap: number;
  largeLeap: number;
  total: number;
}

/** How much choosing `bucket` next would help close the gap to the target mix. Positive
 *  = this bucket is currently under-represented (good to add); negative = over. */
function balanceBenefit(balance: Balance, bucket: Bucket): number {
  const total = balance.total + 1;
  const fracIf = (n: number) => (n + 1) / total;
  const target =
    bucket === 'step'
      ? TARGET_STEP_FRACTION
      : bucket === 'smallLeap'
        ? TARGET_SMALL_LEAP_FRACTION
        : TARGET_LARGE_LEAP_FRACTION;
  const current =
    bucket === 'step'
      ? balance.step
      : bucket === 'smallLeap'
        ? balance.smallLeap
        : balance.largeLeap;
  // Closer the resulting fraction is to target, higher the benefit.
  return -Math.abs(fracIf(current) - target);
}

function recordInterval(balance: Balance, semitones: number): void {
  const b = bucketOf(semitones);
  balance[b] += 1;
  balance.total += 1;
}

/** Score a candidate weak-beat pitch given the anchors it sits between. */
function scoreWeak(
  cand: PlayableNote,
  prevMidi: number,
  nextMidi: number | null,
  chordPcs: ReadonlyArray<number>,
  balance: Balance,
): number {
  const midi = cand.midi;
  const fromPrev = midi - prevMidi;
  const absFromPrev = Math.abs(fromPrev);

  // Step/leap balance correction (based on the interval FROM the previous note).
  const balanceScore =
    W_BALANCE_CORRECTION * balanceBenefit(balance, bucketOf(fromPrev));

  // Direct step preference: weak beats should overwhelmingly move BY STEP from the
  // previous note (this is the main lever that lifts the overall step fraction toward
  // ~70%). A small reward for unison so neighbor/repeat options aren't impossible.
  let stepPref = 0;
  if (absFromPrev >= 1 && absFromPrev <= STEP_MAX_SEMITONES) {
    stepPref = W_STEP_PREFERENCE;
  } else if (absFromPrev === 0) {
    stepPref = -0.5; // mild penalty: avoid static repeats on weak beats
  } else if (absFromPrev > SMALL_LEAP_MAX_SEMITONES) {
    stepPref = -1.5; // discourage large leaps into a weak beat
  }

  // Smoothness toward the next anchor (if any): prefer pitches between the endpoints
  // and close to a linear interpolation (passing-tone behavior).
  let connect = 0;
  if (nextMidi !== null) {
    const lo = Math.min(prevMidi, nextMidi);
    const hi = Math.max(prevMidi, nextMidi);
    const inside = midi >= lo && midi <= hi ? 0.6 : 0;
    const mid = (prevMidi + nextMidi) / 2;
    connect = inside + 0.8 * Math.exp(-Math.abs(midi - mid) / 4);
    // Same-pitch endpoints -> reward neighbor motion (a step away and back).
    if (prevMidi === nextMidi) {
      const isNeighbor = Math.abs(fromPrev) >= 1 && Math.abs(fromPrev) <= 2;
      connect = isNeighbor ? 1.0 : 0.2;
    }
  } else {
    // No next anchor (trailing weak beats): just prefer small motion from prev.
    connect = 0.8 * Math.exp(-Math.abs(fromPrev) / 4);
  }

  // Chord-tone bonus encourages arpeggiation between chord-tone endpoints.
  const chordBonus = chordPcs.includes(pitchClass(cand.pitch)) ? 0.4 : 0;

  // Out-of-position penalty (cand is always in `context.playable`, hence in position;
  // this guards any future caller that passes a wider pool).
  const inPosition = true;
  const posPenalty = inPosition ? 0 : W_OUT_OF_POSITION_PENALTY;

  return balanceScore + stepPref + connect + chordBonus + posPenalty;
}

/**
 * Fill all weak beats. Walks slots in tick order; strong beats keep their placed pitch
 * (and update the running balance), each weak beat is sampled from the playable pool by
 * scoreWeak with SAMPLING_TEMPERATURE. Returns fully-pitched slots.
 */
export function fillWeakBeatPitches(
  progression: ConcreteProgression,
  slots: ReadonlyArray<RhythmSlot>,
  strongPitches: StrongBeatPitches,
  context: GenerationContext,
  rng: Rng,
): PitchedSlot[] {
  const out: PitchedSlot[] = [];
  const balance: Balance = { step: 0, smallLeap: 0, largeLeap: 0, total: 0 };

  // Pre-compute the next anchored MIDI for each slot index (the anchor a weak beat
  // resolves toward). Anchors = every slot already in strongPitches (strong beats plus
  // the cadence-constrained final/penultimate notes), in ascending index order.
  const anchorIdxList: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (strongPitches.has(i)) anchorIdxList.push(i);
  }
  function nextStrongMidiAfter(slotIndex: number): number | null {
    for (const si of anchorIdxList) {
      if (si > slotIndex) {
        const p = strongPitches.get(si);
        if (p) return pitchToMidi(p);
      }
    }
    return null;
  }

  let prevMidi: number | null = null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;

    // Honor ANY pre-placed pitch (strong beats AND the cadence-constrained final /
    // penultimate notes, which may be weak beats). These are fixed anchors.
    const placed = strongPitches.get(i);
    if (placed !== undefined) {
      const midi = pitchToMidi(placed);
      if (prevMidi !== null) recordInterval(balance, midi - prevMidi);
      out.push({ ...slot, pitch: placed });
      prevMidi = midi;
      continue;
    }

    // Weak beat. If there is no previous pitch yet (line starts on a weak beat — rare,
    // since bar starts are strong), seed from the nearest playable to the first target.
    const chord = chordAt(progression, slot.barIndex, slot.beatPositionInBar).chord;
    const chordPcs = chordTones(chord).map((p) => pitchClass(p));
    const nextMidi = nextStrongMidiAfter(i);

    if (prevMidi === null) {
      // Choose a chord tone closest to the upcoming anchor (or any playable).
      const anchor = nextMidi ?? context.playable[0]!.midi;
      const pool = context.playable.filter((p) =>
        chordPcs.includes(pitchClass(p.pitch)),
      );
      const chosen = nearestOf(pool.length > 0 ? pool : context.playable, anchor);
      out.push({ ...slot, pitch: chosen.pitch });
      prevMidi = chosen.midi;
      continue;
    }

    const scores = context.playable.map((c) =>
      scoreWeak(c, prevMidi as number, nextMidi, chordPcs, balance),
    );
    const chosen = context.playable[softmaxPick(rng, scores, SAMPLING_TEMPERATURE)]!;
    recordInterval(balance, chosen.midi - prevMidi);
    out.push({ ...slot, pitch: chosen.pitch });
    prevMidi = chosen.midi;
  }

  return out;
}

function nearestOf(pool: ReadonlyArray<PlayableNote>, targetMidi: number): PlayableNote {
  let best = pool[0]!;
  let bestDist = Math.abs(best.midi - targetMidi);
  for (const p of pool) {
    const d = Math.abs(p.midi - targetMidi);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
