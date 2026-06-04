// Stage 7: placeStrongBeatPitches.
//
// Place the cadence-constrained FINAL pitch first, then the penultimate (if the cadence
// constrains it), then every remaining strong beat in order. Each non-constrained strong
// beat samples a chord tone via a softmax weighted by: proximity to the bar's contour
// target, voice-leading from the previous strong beat (favor stepwise), chord-tone
// stability, a variety penalty for repetition, and a climax-bar boost. Temperature is
// SAMPLING_TEMPERATURE.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Pitch } from '../domain/index.js';
import { chordTones, pitchClass, pitchToMidi } from '../domain/index.js';
import type { ConcreteProgression, ContourTarget } from '../domain/index.js';
import type { CadencePatternEntry } from '../content/cadenceLibrary.js';
import type { GenerationContext, PlayableNote } from './context.js';
import type { RhythmSlot } from './types.js';
import { chordAt } from './selectProgression.js';
import { pickRolePitch } from './cadencePitches.js';
import type { Rng } from './prng.js';
import { softmaxPick } from './prng.js';
import {
  W_CONTOUR_PROXIMITY,
  W_VOICE_LEADING_STEP,
  W_CHORD_TONE_QUALITY,
  W_VARIETY_PENALTY,
  W_CLIMAX_BOOST,
  CHORD_TONE_STABILITY,
  SAMPLING_TEMPERATURE,
  STRONG_BEAT_TARGET_WINDOW,
  STRONG_BEAT_MAX_LEAP,
} from './tuning.js';

/** Map slot index -> chosen pitch for the strong-beat slots only. */
export type StrongBeatPitches = Map<number, Pitch>;

/** Indices into `slots` that are strong beats, in tick order. */
function strongBeatIndices(slots: ReadonlyArray<RhythmSlot>): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]!.isStrongBeat) out.push(i);
  }
  return out;
}

/** Playable notes that are chord tones of `chordTonePitchClasses`, annotated with which
 *  chord-tone position (0=root..3=seventh) they are, for the stability weight. */
interface ChordToneCandidate {
  note: PlayableNote;
  tonePosition: number; // 0..3
}

function chordToneCandidates(
  context: GenerationContext,
  chordTonePcs: ReadonlyArray<number>,
): ChordToneCandidate[] {
  const out: ChordToneCandidate[] = [];
  for (const note of context.playable) {
    const pos = chordTonePcs.indexOf(pitchClass(note.pitch));
    if (pos !== -1) {
      out.push({ note, tonePosition: pos });
    }
  }
  return out;
}

/** Score one chord-tone candidate for a strong beat. Higher = more desirable. */
function scoreCandidate(
  cand: ChordToneCandidate,
  targetMidi: number,
  prevMidi: number | null,
  isClimaxBar: boolean,
  climaxMidi: number,
): number {
  const midi = cand.note.midi;

  // Contour proximity: decay with distance from the bar's target (semitones).
  const contour = W_CONTOUR_PROXIMITY * Math.exp(-Math.abs(midi - targetMidi) / 4);

  // Voice leading: reward stepwise (<=2 st) motion from the previous strong beat.
  let voiceLeading = 0;
  if (prevMidi !== null) {
    const gap = Math.abs(midi - prevMidi);
    voiceLeading = W_VOICE_LEADING_STEP * Math.exp(-gap / 3);
  }

  // Chord-tone stability (root/fifth > third > seventh).
  const stability =
    W_CHORD_TONE_QUALITY * (CHORD_TONE_STABILITY[cand.tonePosition] ?? 0.5);

  // Variety: penalize repeating the previous strong-beat pitch exactly.
  const variety =
    prevMidi !== null && midi === prevMidi ? W_VARIETY_PENALTY : 0;

  // Climax boost: in the climax bar, reward proximity to the climax pitch.
  const climax = isClimaxBar
    ? W_CLIMAX_BOOST * Math.exp(-Math.abs(midi - climaxMidi) / 4)
    : 0;

  return contour + voiceLeading + stability + variety + climax;
}

/**
 * Place the cadence-constrained pitches and every strong-beat pitch. Returns a map from
 * slot index to chosen pitch.
 *
 * The cadence constrains the ACTUAL final SOUNDING note (the last slot) to the melodic
 * `to` role, and the penultimate sounding note (the second-to-last slot) to the `from`
 * role when constrainsPenultimate is set — so the line genuinely ends cadentially even
 * when the last note is a weak beat. Remaining strong beats are then sampled as weighted
 * chord tones.
 */
export function placeStrongBeatPitches(
  progression: ConcreteProgression,
  slots: ReadonlyArray<RhythmSlot>,
  contour: ContourTarget,
  cadence: CadencePatternEntry,
  context: GenerationContext,
  _ticksPerBar: number,
  rng: Rng,
): StrongBeatPitches {
  const result: StrongBeatPitches = new Map();
  if (slots.length === 0) return result;
  const strongIdx = strongBeatIndices(slots);

  const climaxMidi = pitchToMidi(contour.climaxPitch);
  const lastBar = contour.perBarTargets.length - 1;
  const finalTargetMidi = pitchToMidi(
    contour.perBarTargets[lastBar] ?? contour.climaxPitch,
  );

  // 1. Final note = cadence melodic `to` (constrain the LAST slot, strong or weak).
  const finalSlotIdx = slots.length - 1;
  const finalPitch = pickRolePitch(cadence.melodicResolution.to, context, finalTargetMidi);
  result.set(finalSlotIdx, finalPitch);

  // 2. Penultimate note (if constrained) = cadence melodic `from` (second-to-last slot).
  if (cadence.constrainsPenultimate && slots.length >= 2) {
    const penultTargetMidi = pitchToMidi(finalPitch); // resolve smoothly into the final
    const penultPitch = pickRolePitch(
      cadence.melodicResolution.from,
      context,
      penultTargetMidi,
    );
    result.set(slots.length - 2, penultPitch);
  }

  // 3. Remaining strong beats in tick order, each a weighted chord-tone sample.
  let prevMidi: number | null = null;
  for (const idx of strongIdx) {
    if (result.has(idx)) {
      prevMidi = pitchToMidi(result.get(idx)!);
      continue;
    }
    const slot = slots[idx]!;
    const chord = chordAt(progression, slot.barIndex, slot.beatPositionInBar).chord;
    const chordPcs = chordTones(chord).map((p) => pitchClass(p));

    const allChordTones = chordToneCandidates(context, chordPcs);

    const targetMidi = pitchToMidi(
      contour.perBarTargets[slot.barIndex] ?? contour.climaxPitch,
    );
    const isClimaxBar = slot.barIndex === contour.climaxBar;

    // Restrict candidates to chord tones near the bar's contour target AND within a
    // conjunct leap of the previous strong beat. This keeps the strong-beat SKELETON
    // stepwise/small-leap (the dominant lever on the overall step/leap mix); if the
    // filtered set is empty we relax to all chord tones, then to all playable notes.
    let pool = allChordTones.filter((c) => {
      const nearTarget =
        Math.abs(c.note.midi - targetMidi) <= STRONG_BEAT_TARGET_WINDOW;
      const nearPrev =
        prevMidi === null ||
        Math.abs(c.note.midi - prevMidi) <= STRONG_BEAT_MAX_LEAP;
      return nearTarget && nearPrev;
    });
    if (pool.length === 0) pool = allChordTones;
    if (pool.length === 0) {
      // No chord tone playable in position at all: fall back to any playable note
      // (rare; the validator catches a truly unmusical result).
      pool = context.playable.map((note) => ({ note, tonePosition: 0 }));
    }

    const scores = pool.map((c) =>
      scoreCandidate(c, targetMidi, prevMidi, isClimaxBar, climaxMidi),
    );
    const chosen = pool[softmaxPick(rng, scores, SAMPLING_TEMPERATURE)]!;
    result.set(idx, chosen.note.pitch);
    prevMidi = chosen.note.midi;
  }

  return result;
}
