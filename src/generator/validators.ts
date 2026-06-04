// Stage 10: validators.
//
// validatePosition / validateCadence / validateMusicality each throw a ValidationError
// (recoverable -> triggers an outer retry) on failure. Checks per brief section 9/14:
//  - every note playable in the declared position;
//  - the line ends on the cadence's melodic target pitch class;
//  - step/leap balance within STEP_LEAP_TOLERANCE of the 70/25/5 ideal;
//  - no more than MAX_REPEATED_PITCHES identical pitches in a row (unless motivic);
//  - total range <= MAX_RANGE_SEMITONES;
//  - contour roughly realized (melodic high point within CLIMAX_BAR_TOLERANCE bars of plan).
//
// Pure module: no electron/react/DOM, no `any`.

import { pitchClass, pitchToMidi } from '../domain/index.js';
import type { ContourTarget, LineNote } from '../domain/index.js';
import type { NeckPosition } from '../domain/index.js';
import { isPlayableInPosition } from '../fretboard/index.js';
import type { CadencePatternEntry } from '../content/cadenceLibrary.js';
import type { GenerationContext } from './context.js';
import { ValidationError } from './config.js';
import { playableForRole } from './cadencePitches.js';
import {
  STEP_MAX_SEMITONES,
  SMALL_LEAP_MAX_SEMITONES,
  TARGET_STEP_FRACTION,
  TARGET_SMALL_LEAP_FRACTION,
  TARGET_LARGE_LEAP_FRACTION,
  STEP_LEAP_TOLERANCE,
  MAX_REPEATED_PITCHES,
  MAX_RANGE_SEMITONES,
  CLIMAX_BAR_TOLERANCE,
} from './tuning.js';

const sounding = (notes: ReadonlyArray<LineNote>): LineNote[] =>
  notes.filter((n) => n.pitch !== null);

/** Every sounding note must be playable within the declared neck position. */
export function validatePosition(
  notes: ReadonlyArray<LineNote>,
  position: NeckPosition,
): void {
  for (const n of notes) {
    if (n.pitch === null) continue;
    if (!isPlayableInPosition(n.pitch, position)) {
      throw new ValidationError(
        'validatePosition',
        `note ${n.pitch.name}${n.pitch.accidental}${n.pitch.octave} at tick ${n.startTick} not playable in position`,
      );
    }
  }
}

/** The final sounding note must match the cadence's melodic-resolution target pitch
 *  class (i.e. the line lands cadentially). */
export function validateCadence(
  notes: ReadonlyArray<LineNote>,
  cadence: CadencePatternEntry,
  context: GenerationContext,
): void {
  const sng = sounding(notes);
  if (sng.length === 0) {
    throw new ValidationError('validateCadence', 'line has no sounding notes');
  }
  const last = sng[sng.length - 1]!.pitch!;
  const allowed = playableForRole(cadence.melodicResolution.to, context);
  const allowedPcs = new Set(allowed.map((p) => pitchClass(p.pitch)));
  // If the role had no playable pitch (filtered out), accept any tonic-ish landing to
  // avoid a guaranteed fallback; otherwise require the exact pitch class.
  if (allowedPcs.size > 0 && !allowedPcs.has(pitchClass(last))) {
    throw new ValidationError(
      'validateCadence',
      `line ends on ${last.name}${last.accidental} (pc ${pitchClass(last)}), not the cadence target ${cadence.melodicResolution.to}`,
    );
  }
}

/** Step/leap balance, repeated-note cap, total range, and contour realization. */
export function validateMusicality(
  notes: ReadonlyArray<LineNote>,
  contour: ContourTarget,
): void {
  const sng = sounding(notes);
  if (sng.length < 2) {
    // Too short to assess; trivially valid (a single held note, e.g. a whole-note bar).
    return;
  }

  // --- step / leap balance ---
  let step = 0;
  let smallLeap = 0;
  let largeLeap = 0;
  let intervals = 0;
  for (let i = 1; i < sng.length; i++) {
    const semis = Math.abs(pitchToMidi(sng[i]!.pitch!) - pitchToMidi(sng[i - 1]!.pitch!));
    intervals++;
    if (semis <= STEP_MAX_SEMITONES) step++;
    else if (semis <= SMALL_LEAP_MAX_SEMITONES) smallLeap++;
    else largeLeap++;
  }
  if (intervals > 0) {
    const sf = step / intervals;
    const slf = smallLeap / intervals;
    const llf = largeLeap / intervals;
    if (
      Math.abs(sf - TARGET_STEP_FRACTION) > STEP_LEAP_TOLERANCE ||
      Math.abs(slf - TARGET_SMALL_LEAP_FRACTION) > STEP_LEAP_TOLERANCE ||
      Math.abs(llf - TARGET_LARGE_LEAP_FRACTION) > STEP_LEAP_TOLERANCE
    ) {
      throw new ValidationError(
        'validateMusicality',
        `step/leap mix step=${sf.toFixed(2)} smallLeap=${slf.toFixed(2)} largeLeap=${llf.toFixed(2)} outside tolerance ${STEP_LEAP_TOLERANCE}`,
      );
    }
  }

  // --- repeated identical pitches in a row ---
  let run = 1;
  for (let i = 1; i < sng.length; i++) {
    if (pitchToMidi(sng[i]!.pitch!) === pitchToMidi(sng[i - 1]!.pitch!)) {
      run++;
      if (run > MAX_REPEATED_PITCHES) {
        throw new ValidationError(
          'validateMusicality',
          `${run} identical pitches in a row exceeds ${MAX_REPEATED_PITCHES}`,
        );
      }
    } else {
      run = 1;
    }
  }

  // --- total range ---
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of sng) {
    const m = pitchToMidi(n.pitch!);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  if (hi - lo > MAX_RANGE_SEMITONES) {
    throw new ValidationError(
      'validateMusicality',
      `total range ${hi - lo} semitones exceeds ${MAX_RANGE_SEMITONES}`,
    );
  }

  // --- contour roughly realized: the actual high point bar near the planned climax ---
  let peakBar = sng[0]!.barIndex;
  let peakMidi = pitchToMidi(sng[0]!.pitch!);
  for (const n of sng) {
    const m = pitchToMidi(n.pitch!);
    if (m > peakMidi) {
      peakMidi = m;
      peakBar = n.barIndex;
    }
  }
  // invertedArch reports its climaxBar as the LOW extreme; assess the low point there.
  if (contour.shape === 'invertedArch') {
    let valleyBar = sng[0]!.barIndex;
    let valleyMidi = pitchToMidi(sng[0]!.pitch!);
    for (const n of sng) {
      const m = pitchToMidi(n.pitch!);
      if (m < valleyMidi) {
        valleyMidi = m;
        valleyBar = n.barIndex;
      }
    }
    if (Math.abs(valleyBar - contour.climaxBar) > CLIMAX_BAR_TOLERANCE) {
      throw new ValidationError(
        'validateMusicality',
        `invertedArch low point in bar ${valleyBar}, planned ${contour.climaxBar}`,
      );
    }
    return;
  }
  // steady has no strong peak requirement.
  if (contour.shape === 'steady') return;

  if (Math.abs(peakBar - contour.climaxBar) > CLIMAX_BAR_TOLERANCE) {
    throw new ValidationError(
      'validateMusicality',
      `melodic peak in bar ${peakBar}, planned climax bar ${contour.climaxBar} (shape ${contour.shape})`,
    );
  }
}
