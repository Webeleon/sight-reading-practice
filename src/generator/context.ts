// Stage 1: buildGenerationContext.
//
// Computes everything the later stages reason over, derived from (config, key,
// position): the set of playable pitches within the neck position, each spelled in the
// key and labeled diatonic vs chromatic with its scale degree; the key's diatonic
// scale; the strong-beat tick positions of the bar; and the tonic & dominant pitches
// that fall inside the playable range (the cadence/contour stages anchor on these).
//
// Chromatic admission is filtered by config.accidentalsDensity via the seeded PRNG, so
// the SAME (seed, attempt) always yields the same admitted vocabulary.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Pitch, Key } from '../domain/index.js';
import {
  midiToPitch,
  pitchToMidi,
  diatonicScale,
  scaleDegreeOf,
  ticksPerBar,
} from '../domain/index.js';
import { computePlayablePitches } from '../fretboard/index.js';
import type { StringFret } from '../fretboard/index.js';
import type { LineConfig } from './config.js';
import { ACCIDENTAL_ADMIT_PROBABILITY } from './tuning.js';
import type { Rng } from './prng.js';

/** A pitch the line may use, fully resolved against key + position. */
export interface PlayableNote {
  pitch: Pitch; // spelled in the line's key
  midi: number; // sounding MIDI (authoritative for ordering / playability)
  diatonic: boolean; // true if the pitch class is in the key's diatonic scale
  scaleDegree: number | null; // 1..7 if diatonic, else null
  stringFretOptions: StringFret[]; // how to play it (INVERTED string numbering)
}

export interface GenerationContext {
  key: Key;
  /** Spelled, sounding-MIDI-ascending vocabulary the line may draw from, already
   *  filtered by accidentalsDensity. Diatonic notes are always present; chromatic
   *  notes appear only if admitted. */
  playable: PlayableNote[];
  diatonicScale: Pitch[]; // the 7 spelled scale degrees (octave 4 baseline)
  /** Tick positions within a bar that are strong beats (from the time signature). */
  strongBeatTicks: number[];
  ticksPerBar: number;
  /** Tonic (degree 1) pitches that fall inside the playable range, MIDI-ascending. */
  tonicPitches: PlayableNote[];
  /** Dominant (degree 5) pitches that fall inside the playable range, MIDI-ascending. */
  dominantPitches: PlayableNote[];
}

/**
 * Build the generation context. The RNG is consumed to decide chromatic admission, so
 * pass the SAME threaded PRNG the rest of the pipeline uses (keeps the whole line a
 * pure function of seed).
 */
export function buildGenerationContext(
  config: LineConfig,
  rng: Rng,
): GenerationContext {
  const { key, position, timeSignature, accidentalsDensity } = config;

  const scale = diatonicScale(key);
  const admitProb = ACCIDENTAL_ADMIT_PROBABILITY[accidentalsDensity];

  // computePlayablePitches returns unspelled {midi, pitchClass, stringFretOptions};
  // we spell each against the key and label diatonic/chromatic.
  const raw = computePlayablePitches(position);

  const playable: PlayableNote[] = [];
  for (const rp of raw) {
    const pitch = midiToPitch(rp.midi, key);
    const degree = scaleDegreeOf(pitch, key);
    const diatonic = degree !== null;

    if (!diatonic) {
      // Chromatic: admit stochastically by density. 'none' -> admitProb 0 -> never.
      if (rng() >= admitProb) {
        continue;
      }
    }

    playable.push({
      pitch,
      midi: rp.midi,
      diatonic,
      scaleDegree: degree,
      stringFretOptions: rp.stringFretOptions,
    });
  }

  // Already MIDI-ascending from computePlayablePitches, but be explicit.
  playable.sort((a, b) => a.midi - b.midi);

  const tonicPitches = playable.filter((p) => p.scaleDegree === 1);
  const dominantPitches = playable.filter((p) => p.scaleDegree === 5);

  return {
    key,
    playable,
    diatonicScale: scale,
    strongBeatTicks: [...timeSignature.strongBeats],
    ticksPerBar: ticksPerBar(timeSignature),
    tonicPitches,
    dominantPitches,
  };
}

/** Convenience: the playable note whose sounding MIDI is closest to `targetMidi`
 *  (ties broken toward the lower pitch). Returns undefined only if `playable` empty. */
export function nearestPlayable(
  playable: ReadonlyArray<PlayableNote>,
  targetMidi: number,
): PlayableNote | undefined {
  let best: PlayableNote | undefined;
  let bestDist = Infinity;
  for (const p of playable) {
    const d = Math.abs(p.midi - targetMidi);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Convenience used by several stages: midi of a spelled pitch. */
export function midiOf(p: Pitch): number {
  return pitchToMidi(p);
}
