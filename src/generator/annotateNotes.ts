// Stage 9: annotateNotes.
//
// Turn the fully-pitched slots into persisted LineNotes, computing per note: the implied
// chord, the chord-tone role (root/third/fifth/seventh, else passing/neighbor/chromatic
// /nonChordTone), isStrongBeat, barIndex, beatPositionInBar, and the tie flag. The
// interval-from-previous is not stored on LineNote (the schema derives it at persistence
// time) but the role classification uses it.
//
// Pure module: no electron/react/DOM, no `any`.

import type { Pitch } from '../domain/index.js';
import { chordTones, pitchClass, pitchToMidi } from '../domain/index.js';
import type { ConcreteProgression, ChordToneRole, LineNote } from '../domain/index.js';
import { chordAt } from './selectProgression.js';
import type { PitchedSlot } from './types.js';
import { STEP_MAX_SEMITONES } from './tuning.js';

/** Classify a note's role against its implied chord and its melodic neighbors. */
function classifyRole(
  pitch: Pitch,
  chordTonePcs: ReadonlyArray<number>,
  prev: Pitch | null,
  next: Pitch | null,
): ChordToneRole {
  const pc = pitchClass(pitch);
  const tonePos = chordTonePcs.indexOf(pc);
  if (tonePos === 0) return 'root';
  if (tonePos === 1) return 'third';
  if (tonePos === 2) return 'fifth';
  if (tonePos === 3) return 'seventh';

  // Non-chord tone: refine into passing / neighbor / chromatic when neighbors allow.
  const midi = pitchToMidi(pitch);
  if (prev !== null && next !== null) {
    const pm = pitchToMidi(prev);
    const nm = pitchToMidi(next);
    const fromPrev = midi - pm;
    const toNext = nm - midi;
    const stepIn = Math.abs(fromPrev) <= STEP_MAX_SEMITONES;
    const stepOut = Math.abs(toNext) <= STEP_MAX_SEMITONES;
    // Passing tone: stepwise through, same direction in and out.
    if (stepIn && stepOut && Math.sign(fromPrev) === Math.sign(toNext) && fromPrev !== 0) {
      return 'passing';
    }
    // Neighbor tone: step away and back to the same pitch.
    if (stepIn && stepOut && pm === nm) {
      return 'neighbor';
    }
  }

  // A non-diatonic-ish leftover; if it is chromatic relative to the chord, mark it.
  return 'nonChordTone';
}

/**
 * Annotate the pitched slots into LineNotes. `slots` must be tick-ascending. Ties are
 * not produced by the starter pipeline (motifs have no cross-bar ties), so tiedToNext is
 * always false here; the field exists for the schema and future use.
 */
export function annotateNotes(
  progression: ConcreteProgression,
  slots: ReadonlyArray<PitchedSlot>,
): LineNote[] {
  const notes: LineNote[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const chord = chordAt(progression, slot.barIndex, slot.beatPositionInBar).chord;
    const chordTonePcs = chordTones(chord).map((p) => pitchClass(p));

    const prev = i > 0 ? slots[i - 1]!.pitch : null;
    const next = i + 1 < slots.length ? slots[i + 1]!.pitch : null;

    const role: ChordToneRole =
      slot.pitch === null
        ? 'nonChordTone'
        : classifyRole(slot.pitch, chordTonePcs, prev, next);

    notes.push({
      pitch: slot.pitch,
      duration: slot.duration,
      startTick: slot.startTick,
      barIndex: slot.barIndex,
      beatPositionInBar: slot.beatPositionInBar,
      isStrongBeat: slot.isStrongBeat,
      impliedChord: chord,
      chordToneRole: role,
      tiedToNext: false,
    });
  }

  return notes;
}

/** The signed semitone interval from the previous sounding note (null for the first
 *  note or after/before a rest). Exposed for the persistence layer, which stores it on
 *  note_events. */
export function intervalFromPrevious(
  notes: ReadonlyArray<LineNote>,
  index: number,
): number | null {
  if (index <= 0) return null;
  const cur = notes[index]!.pitch;
  const prev = notes[index - 1]!.pitch;
  if (cur === null || prev === null) return null;
  return pitchToMidi(cur) - pitchToMidi(prev);
}
