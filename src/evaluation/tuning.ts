// evaluation/tuning.ts — THE one place to tune evaluation behaviour.
//
// PURE module (no Web Audio / DOM / React / Electron; no `any`). Everything the
// aligner/classifier/metrics consults lives here as a NAMED, DOCUMENTED constant
// so the human can calibrate the feel of the feedback without reading the logic.
//
// Brief section 13 (Evaluation) requires, and names below, four tunable things:
//   1. an onset tolerance band that SCALES with tempo and subdivision
//      (generous at slow tempo / quarters, tight at fast tempo / sixteenths),
//   2. an ASYMMETRIC early-vs-late split of that band (allow more lateness
//      than earliness — a guitar note tends to speak slightly after the beat),
//   3. the ~100ms TRAILING-EVALUATION delay (the UI waits this long past the
//      cursor before it commits a note's colour, to let pitch confidence and the
//      timing band resolve),
//   4. the PITCH match rule (exact MIDI) and the clarity floor below which a
//      detection is too unreliable to trust.
//
// All times are in MILLISECONDS unless a name says otherwise.

/**
 * Subdivision = the smallest rhythmic grid the reader is expected to hit, named
 * by how many of them fit in one beat (a quarter at the configured tempo):
 *   - 'quarter'   -> 1 per beat   (loosest grid)
 *   - 'eighth'    -> 2 per beat
 *   - 'triplet'   -> 3 per beat
 *   - 'sixteenth' -> 4 per beat   (tightest grid)
 * The audio/UI layer derives this from the line's rhythm (finest note value
 * present) and passes it in; evaluation never inspects the Line itself.
 */
export type Subdivision = 'quarter' | 'eighth' | 'triplet' | 'sixteenth';

/**
 * BASE onset tolerance, in milliseconds, BEFORE any tempo/subdivision scaling.
 * This is the half-width of the matching band at the reference tempo
 * (REFERENCE_TEMPO_BPM) on a quarter-note grid. Bigger = more forgiving timing.
 * 90ms reads as "within a tenth of a second of the beat counts as on time",
 * which is a reasonable starting point for an intermediate sight-reader; tune
 * down if timing_accuracy feels too generous, up if it feels punishing.
 */
export const BASE_ONSET_TOLERANCE_MS = 90;

/**
 * The tempo at which BASE_ONSET_TOLERANCE_MS applies as-is. At other tempos the
 * band scales by REFERENCE_TEMPO_BPM / tempo (see onsetToleranceMs): a faster
 * tempo packs beats closer together, so the absolute ms band must shrink to
 * keep the SAME musical fraction of a beat. 120 BPM = the brief's worked tempo.
 */
export const REFERENCE_TEMPO_BPM = 120;

/**
 * How aggressively the band shrinks with tempo. The tempo factor is
 *   (REFERENCE_TEMPO_BPM / tempo) ** TEMPO_SCALING_EXPONENT
 * - 1.0 = band is a constant FRACTION OF A BEAT (fully tempo-relative): at
 *   double tempo the ms band halves.
 * - 0.0 = band is a constant ABSOLUTE ms regardless of tempo.
 * 0.85 sits just inside fully-relative so very fast tempos stay a hair more
 * forgiving in absolute ms terms (human reaction time has an absolute floor).
 */
export const TEMPO_SCALING_EXPONENT = 0.85;

/**
 * Multiplier on the band per subdivision: a finer grid means adjacent expected
 * onsets sit closer together, so the band must tighten or windows of
 * neighbouring notes would overlap and steal each other's detections. These are
 * relative to the quarter-note grid (= 1.0). Tighter grid -> smaller factor.
 */
export const SUBDIVISION_TOLERANCE_FACTOR: Readonly<Record<Subdivision, number>> = {
  quarter: 1.0,
  eighth: 0.7,
  triplet: 0.55,
  sixteenth: 0.45,
};

/**
 * Asymmetric split of the (scaled) band into an EARLY half-width and a LATE
 * half-width. A detection at onset+dt is in-band iff
 *   -EARLY_TOLERANCE_FRACTION * W  <=  dt  <=  +LATE_TOLERANCE_FRACTION * W
 * where W is the scaled symmetric band from onsetToleranceMs().
 *
 * LATE > EARLY on purpose: rushing (playing ahead of the beat) is the worse
 * sight-reading fault and a plucked/bowed note physically speaks a touch after
 * the player's intent, so we forgive lateness more than earliness. With the
 * values below a note may land up to 1.4*W late but only 0.6*W early and still
 * count as a hit — so a note late by amount X can be admitted while an
 * early-by-the-same-X note is rejected (this asymmetry is asserted in tests).
 */
export const EARLY_TOLERANCE_FRACTION = 0.6;
export const LATE_TOLERANCE_FRACTION = 1.4;

/**
 * Trailing-evaluation delay (brief sections 13 & 12): the UI commits a note's
 * colour ~this long AFTER the cursor passes the note's onset, so a slightly-late
 * but correct note still gets to register as a hit (rather than flashing
 * "missed" the instant the cursor moves on) and pitch confidence has time to
 * settle. Evaluation itself is offline/pure; this constant lives here so the UI
 * and the LATE band are tuned from the SAME place and kept consistent.
 */
export const TRAILING_EVALUATION_DELAY_MS = 100;

/**
 * Pitch match rule: detected MIDI must equal expected MIDI within this many
 * semitones to count as the "right pitch". 0 = exact MIDI match (the brief's
 * rule). Kept as a constant so the human could relax it to 1 if octave/string
 * confusion in detection proves common, without touching classify.ts.
 */
export const PITCH_TOLERANCE_SEMITONES = 0;

/**
 * Clarity floor: detections whose `clarity` (0..1 confidence from the pitch
 * detector) is below this are too unreliable to evaluate and are dropped before
 * alignment (treated as if never detected). Detections with no clarity field are
 * trusted (clarity is optional in DetectedNote). 0.6 is a placeholder pending
 * real-guitar measurement at Human Review Gate 3 — see LEARNINGS.md.
 */
export const CLARITY_THRESHOLD = 0.6;

/**
 * The scaled SYMMETRIC half-band W in ms for a given tempo + subdivision,
 * before the early/late asymmetry is applied. Combines the base band, the
 * tempo factor, and the subdivision factor. Exposed (not just used internally)
 * so the UI can show "timing band: +-Xms" and so tests can assert the scaling.
 */
export function onsetToleranceMs(tempoBpm: number, subdivision: Subdivision): number {
  const tempoFactor = Math.pow(REFERENCE_TEMPO_BPM / tempoBpm, TEMPO_SCALING_EXPONENT);
  const subdivisionFactor = SUBDIVISION_TOLERANCE_FACTOR[subdivision];
  return BASE_ONSET_TOLERANCE_MS * tempoFactor * subdivisionFactor;
}

/** The asymmetric band bounds (relative to an expected onset) at this tempo +
 *  subdivision. `earlyMs` is a POSITIVE magnitude of allowed earliness; a
 *  detection at expectedOnset + dt is in-band iff -earlyMs <= dt <= lateMs. */
export interface ToleranceWindow {
  /** Allowed earliness magnitude in ms (detection before the onset). */
  earlyMs: number;
  /** Allowed lateness magnitude in ms (detection after the onset). */
  lateMs: number;
  /** The underlying symmetric half-band W in ms (for display/logging). */
  symmetricMs: number;
}

/** Build the asymmetric tolerance band for a tempo + subdivision. */
export function toleranceWindow(
  tempoBpm: number,
  subdivision: Subdivision,
): ToleranceWindow {
  const symmetricMs = onsetToleranceMs(tempoBpm, subdivision);
  return {
    earlyMs: symmetricMs * EARLY_TOLERANCE_FRACTION,
    lateMs: symmetricMs * LATE_TOLERANCE_FRACTION,
    symmetricMs,
  };
}
