// Helper: resolve a cadence's melodic-resolution scale-degree ROLES (tonic, leadingTone,
// supertonic, ...) into concrete playable pitches in the line's key/position. Used by
// placeStrongBeats to fix the final (and optionally penultimate) note before anything
// else.
//
// Pure module: no electron/react/DOM, no `any`.

import type { Pitch } from '../domain/index.js';
import { pitchClass } from '../domain/index.js';
import type {
  CadenceMelodicFrom,
  CadenceMelodicTo,
} from '../content/cadenceLibrary.js';
import type { GenerationContext, PlayableNote } from './context.js';

/** Map a melodic-resolution role to a 1-based scale degree. leadingTone is the raised
 *  7th in minor (handled via pitch-class below), the diatonic 7th in major. */
const ROLE_TO_DEGREE: Readonly<
  Record<CadenceMelodicFrom | CadenceMelodicTo, number>
> = {
  tonic: 1,
  supertonic: 2,
  mediant: 3,
  subdominant: 4,
  dominant: 5,
  submediant: 6,
  leadingTone: 7,
};

/** The sounding pitch class for a cadence role in this key. For leadingTone in a minor
 *  key we raise the natural-minor 7th by a semitone (the actual leading tone). */
function rolePitchClass(
  role: CadenceMelodicFrom | CadenceMelodicTo,
  context: GenerationContext,
): number {
  const degree = ROLE_TO_DEGREE[role];
  const scaleDegreePitch = context.diatonicScale[degree - 1]!;
  let pc = pitchClass(scaleDegreePitch);
  if (role === 'leadingTone' && context.key.mode === 'minor') {
    pc = (pc + 1) % 12; // raise the subtonic to the leading tone
  }
  return pc;
}

/** All playable notes whose pitch class matches a cadence role, MIDI-ascending. May be
 *  empty if (e.g.) the raised leading tone was filtered out by accidentalsDensity. */
export function playableForRole(
  role: CadenceMelodicFrom | CadenceMelodicTo,
  context: GenerationContext,
): PlayableNote[] {
  const pc = rolePitchClass(role, context);
  return context.playable.filter((p) => pitchClass(p.pitch) === pc);
}

/** Choose the cadence target pitch closest to a preferred MIDI (the contour target of
 *  the final bar). Falls back to any playable pitch if the role is unavailable, so the
 *  ending is always defined (the validator catches truly bad endings). */
export function pickRolePitch(
  role: CadenceMelodicFrom | CadenceMelodicTo,
  context: GenerationContext,
  preferMidi: number,
): Pitch {
  const candidates = playableForRole(role, context);
  const pool = candidates.length > 0 ? candidates : context.playable;
  let best = pool[0]!;
  let bestDist = Math.abs(best.midi - preferMidi);
  for (const p of pool) {
    const d = Math.abs(p.midi - preferMidi);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.pitch;
}
