// ============================================================================
// GENERATOR TUNING SURFACE
// ============================================================================
// This is the human's single tuning file (brief section 9). Every scoring weight,
// sampling temperature, and validation threshold the generator uses lives here as a
// NAMED constant with a comment documenting its effect. Tune the generator by editing
// numbers here — never by hunting through pipeline logic.
//
// Pure module: no electron/react/DOM, seeded-PRNG only (no global random), no `any`.
// ----------------------------------------------------------------------------

// --- Outer loop -------------------------------------------------------------

/** How many times the whole pipeline may be re-run (with the RNG advanced) before
 *  giving up and returning a fallback line. Higher = fewer fallbacks, slower worst
 *  case. Brief section 9 fixes this at 10. */
export const MAX_OUTER_ATTEMPTS = 10;

// --- Strong-beat pitch placement: scoring weights ---------------------------
// Stage 7 places each non-constrained strong beat by scoring every candidate chord
// tone and sampling one with a softmax over these weighted features. Raise a weight
// to make that feature dominate the choice.

/** Reward for landing close to the bar's contour target pitch. Multiplies a
 *  proximity score that decays with semitone distance. Higher = contour is tracked
 *  more tightly (melody hugs the planned shape); too high makes every bar sound the
 *  same height. */
export const W_CONTOUR_PROXIMITY = 1.6;

/** Reward for stepwise (<= 2 semitone) voice leading from the previous strong beat.
 *  Higher = smoother, more conjunct strong-beat motion; too high kills leaps the
 *  contour wants. */
export const W_VOICE_LEADING_STEP = 1.4;

/** Reward scaling by chord-tone quality (root/fifth favored over third/seventh as a
 *  stable landing tone). Higher = strong beats sit on the most consonant tones. */
export const W_CHORD_TONE_QUALITY = 0.8;

/** Penalty (subtracted, so negative weight) for repeating the previous strong-beat
 *  pitch. More negative = more melodic variety, fewer static repeated notes. */
export const W_VARIETY_PENALTY = -1.2;

/** Boost applied to candidates near the climax pitch when placing a strong beat in
 *  the planned climax bar. Higher = a more pronounced, audible high point. */
export const W_CLIMAX_BOOST = 1.5;

/** Strong-beat candidates are restricted to chord tones within this many semitones of
 *  the bar's contour target, so the skeleton tracks the planned shape without jumping to
 *  a distant register. Widen for looser contour adherence. */
export const STRONG_BEAT_TARGET_WINDOW = 7;

/** Maximum semitone leap allowed between consecutive strong beats (the conjunct cap on
 *  the skeleton). Candidates beyond this from the previous strong beat are excluded
 *  unless none remain. 5 = a perfect fourth (a step or small leap). Lower = smoother but
 *  more repetitive; higher = more leaps and a higher fallback rate. */
export const STRONG_BEAT_MAX_LEAP = 5;

/** Per-tone preference used by W_CHORD_TONE_QUALITY. Root/fifth are the most stable
 *  landing tones; the third defines quality; the seventh is the most tension-laden.
 *  Indexed by chord-tone position (0=root,1=third,2=fifth,3=seventh). */
export const CHORD_TONE_STABILITY: ReadonlyArray<number> = [1.0, 0.6, 0.85, 0.45];

// --- Softmax sampling temperature -------------------------------------------

/** Temperature of the softmax weighted sampler used in strong-beat placement.
 *  -> 0 approaches deterministic argmax (always the best-scoring tone, repetitive).
 *  -> large flattens toward uniform (more random, less musical). ~0.7 keeps choices
 *  mostly sensible while preserving variety across seeds. */
export const SAMPLING_TEMPERATURE = 0.7;

// --- Weak-beat fill: step / leap balance ------------------------------------
// Stage 8 fills weak beats with connecting motion while steering the running interval
// mix toward these targets. The validator (validateMusicality) checks the realized mix
// against the same targets within STEP_LEAP_TOLERANCE.

/** Target fraction of melodic intervals that are steps (<= 2 semitones). Brief: ~70%. */
export const TARGET_STEP_FRACTION = 0.7;

/** Target fraction that are small leaps (3..5 semitones, i.e. a 3rd or 4th). ~25%. */
export const TARGET_SMALL_LEAP_FRACTION = 0.25;

/** Target fraction that are large leaps (>= 6 semitones). ~5%. */
export const TARGET_LARGE_LEAP_FRACTION = 0.05;

/** Upper semitone bound (inclusive) for an interval to count as a STEP. */
export const STEP_MAX_SEMITONES = 2;

/** Upper semitone bound (inclusive) for a SMALL LEAP; above this is a LARGE leap. */
export const SMALL_LEAP_MAX_SEMITONES = 5;

/** Allowed absolute deviation of each realized fraction from its target before
 *  validateMusicality fails. Wider = more permissive (fewer retries / fallbacks),
 *  but lines drift further from the conjunct ideal. 0.18 keeps it loose enough that
 *  short lines (few intervals -> coarse fractions) usually pass. */
export const STEP_LEAP_TOLERANCE = 0.18;

/** When choosing a weak-beat connector, how strongly to prefer the option that pushes
 *  the running step/leap mix back toward target. Higher = tighter adherence to the
 *  70/25/5 ideal; too high makes every passage uniformly stepwise. */
export const W_BALANCE_CORRECTION = 2.0;

/** Flat reward for a weak beat that moves BY STEP (1-2 semitones) from the previous
 *  note. This is the primary lever lifting the overall step fraction toward ~70%, since
 *  most notes are weak beats. Higher = more scalar/conjunct lines. */
export const W_STEP_PREFERENCE = 2.5;

/** Penalty weight for a weak-beat candidate that lands OUTSIDE the playable position.
 *  Brief: "heavily penalize out-of-position pitches." Large so they are effectively
 *  never chosen when any in-position option exists. */
export const W_OUT_OF_POSITION_PENALTY = -1000;

// --- Validation thresholds --------------------------------------------------

/** Maximum number of identical pitches in a row before validateMusicality fails
 *  (unless the repetition is motivic). Brief: "no more than 3 repeated." */
export const MAX_REPEATED_PITCHES = 3;

/** Maximum total melodic range (highest minus lowest sounding MIDI) in semitones.
 *  Brief: "<= ~1.5 octaves typical." 1.5 octaves = 18 semitones; a little margin is
 *  allowed via this constant. */
export const MAX_RANGE_SEMITONES = 19;

/** validateContour: the realized melodic high point must fall in the planned climax
 *  bar, OR within this many bars of it, for the contour to count as "roughly realized."
 *  0 = strict (exact bar); 1 tolerates an adjacent-bar climax for short/dense lines. */
export const CLIMAX_BAR_TOLERANCE = 1;

// --- Accidentals density (chromatic admission) ------------------------------
// buildGenerationContext filters which non-diatonic (chromatic) pitches the line may
// use, by config.accidentalsDensity. These are the probabilities a given chromatic
// pitch class is admitted to the playable pool, per density level.

/** Chromatic admission probability per accidentalsDensity level. 'none' forbids all
 *  chromatics (pure diatonic); higher levels admit more passing chromaticism. The
 *  generator still prefers diatonic motion via the weak-beat scorer; this just caps
 *  the vocabulary. */
export const ACCIDENTAL_ADMIT_PROBABILITY: Readonly<
  Record<'none' | 'low' | 'medium' | 'high', number>
> = {
  none: 0.0,
  low: 0.15,
  medium: 0.4,
  high: 0.75,
};

// --- Contour working range --------------------------------------------------

/** The melodic line is confined to a register band of this many semitones, placed
 *  randomly inside the (possibly ~2-octave) playable position. Keeping the line inside
 *  roughly an octave is what makes the strong-beat skeleton conjunct and keeps the total
 *  range under MAX_RANGE_SEMITONES. Raise for wider, more dramatic lines (more leaps,
 *  more fallbacks); lower for tighter, more stepwise lines. 12 = one octave. */
export const CONTOUR_WORKING_RANGE_SEMITONES = 12;

// --- Phrase structure weighting ---------------------------------------------

/** Relative selection weights for phrase patterns by bar count bucket. The generator
 *  filters patterns compatible with barCount, then samples by these weights (weighted
 *  toward repetition for shorter lines, through-composed for longer ones). */
export const PHRASE_PATTERN_WEIGHTS: Readonly<
  Record<'AAAB' | 'ABAB' | 'ABAC' | 'throughComposed', number>
> = {
  AAAB: 1.2,
  ABAB: 1.0,
  ABAC: 0.9,
  throughComposed: 0.7,
};

// --- Rhythm variation -------------------------------------------------------

/** Probability that a given bar (other than the first) receives a subtle rhythmic
 *  variation (displacement/augmentation/omission) in planRhythm. Higher = more
 *  rhythmic interest but less predictable reading. */
export const RHYTHM_VARIATION_PROBABILITY = 0.2;
