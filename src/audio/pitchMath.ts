// pitchMath.ts — PURE pitch/frequency helpers for the audio layer.
//
// IMPORTANT: this file lives under src/audio (which compiles under tsconfig.ui,
// so DOM/WebAudio globals are technically available), but it deliberately uses
// NONE of them. It is plain arithmetic over numbers so it can be unit-tested in
// the vitest NODE environment exactly like a pure module (the brief requires the
// frequency->MIDI conversion and clarity gating to be node-testable). Keep it
// free of any Web Audio / DOM reference.
//
// No `any`. No I/O. No globals.

/**
 * A4 reference frequency (the tuning standard). 440 Hz == MIDI 69. Named so the
 * human can retune to e.g. 442 Hz if a particular reference pitch is used at
 * Gate 3, without hunting through the conversion math.
 */
export const A4_HZ = 440;

/** MIDI number of the A4 reference (concert A). */
export const A4_MIDI = 69;

/**
 * The lowest / highest MIDI notes a 6-string guitar in standard tuning can
 * sound across the prototype's neck positions: low E (string 1 open) = MIDI 40,
 * and a generous high bound (high E, 17th fret) ~= MIDI 88. Detections outside
 * this band are almost certainly octave errors or noise (a fundamental an octave
 * off, a harmonic, a hum) and are rejected before they reach evaluation.
 * Matches the domain's stated guitar range (brief sections 6/7, "MIDI 40-88").
 */
export const GUITAR_MIDI_LOW = 40;
export const GUITAR_MIDI_HIGH = 88;

/**
 * Convert a frequency in Hz to a (fractional, unrounded) MIDI number using the
 * equal-tempered formula  midi = 69 + 12 * log2(f / 440). Returns a float so the
 * caller can inspect cents-off-from-equal-temperament before rounding. A
 * non-positive / non-finite frequency yields NaN (pitchy returns 0 Hz when it
 * finds no pitch — callers must guard with Number.isFinite / clarity gating).
 */
export function frequencyToMidiFloat(frequencyHz: number): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return NaN;
  return A4_MIDI + 12 * Math.log2(frequencyHz / A4_HZ);
}

/**
 * Convert a frequency in Hz to the NEAREST integer MIDI note. NaN for a
 * non-positive/invalid frequency (see frequencyToMidiFloat).
 */
export function frequencyToMidi(frequencyHz: number): number {
  const m = frequencyToMidiFloat(frequencyHz);
  return Number.isNaN(m) ? NaN : Math.round(m);
}

/** Inverse: the frequency (Hz) of an (integer or fractional) MIDI note. */
export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Cents that a frequency is sharp (+) or flat (-) of its nearest equal-tempered
 * MIDI note, in [-50, +50). Useful for logging detector accuracy at Gate 3
 * ("how many cents off were clean notes?") and for a future stability check.
 */
export function centsOffNearestMidi(frequencyHz: number): number {
  const m = frequencyToMidiFloat(frequencyHz);
  if (Number.isNaN(m)) return NaN;
  return (m - Math.round(m)) * 100;
}

/**
 * Whether a detected MIDI value is inside the guitar's plausible range. A
 * detection outside [GUITAR_MIDI_LOW, GUITAR_MIDI_HIGH] is dropped as an
 * octave/harmonic/noise artifact rather than fed to evaluation.
 */
export function isInGuitarRange(midi: number): boolean {
  return (
    Number.isFinite(midi) && midi >= GUITAR_MIDI_LOW && midi <= GUITAR_MIDI_HIGH
  );
}

/**
 * Clarity gating predicate. A raw detection is trustworthy iff its clarity meets
 * the threshold AND it produced a usable in-range MIDI value. This is the single
 * gate the live detector and the tests share, so "what counts as a real note"
 * is defined in exactly one pure place.
 *
 * @param frequencyHz   detected fundamental (0/NaN when pitchy found nothing).
 * @param clarity       pitchy clarity in [0,1].
 * @param clarityFloor  the minimum clarity to accept (named constant supplied by
 *                      the caller — see CLARITY_THRESHOLD in pitchDetector.ts).
 */
export function isUsableDetection(
  frequencyHz: number,
  clarity: number,
  clarityFloor: number,
): boolean {
  if (!Number.isFinite(clarity) || clarity < clarityFloor) return false;
  const midi = frequencyToMidi(frequencyHz);
  return isInGuitarRange(midi);
}
