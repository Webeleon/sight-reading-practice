// Internal pipeline value types passed between generator stages.
//
// These are NOT the persisted domain shapes (those live in domain/line.ts). They are
// scratch structures the stages hand to one another: rhythm slots before pitches are
// chosen, then per-slot pitch assignments. Kept here so each stage file stays focused.
//
// Pure module: no electron/react/DOM, no `any`.

import type { Duration, Pitch } from '../domain/index.js';

/** One rhythmic event before a pitch is chosen. A slot is either a note position to be
 *  filled or a rest. tick is ABSOLUTE from line start. */
export interface RhythmSlot {
  startTick: number; // absolute from line start
  duration: Duration;
  barIndex: number;
  beatPositionInBar: number; // tick offset within its bar
  isStrongBeat: boolean; // onset coincides with a time-signature strong beat
  isRest: boolean; // placeholder: starter motifs produce no rests, kept for completeness
}

/** A rhythm slot after a pitch has been assigned (null = rest). */
export interface PitchedSlot extends RhythmSlot {
  pitch: Pitch | null;
}
