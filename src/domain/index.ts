// Barrel for the pure domain model. Types and values are re-exported separately
// because verbatimModuleSyntax requires `export type` for type-only symbols.

// --- pitch ---
export type { NoteName, Accidental, Pitch } from './pitch.js';
export {
  pitchToMidi,
  midiToPitch,
  pitchClass,
  pitchesEnharmonicEqual,
  prettyPitch,
} from './pitch.js';

// --- duration ---
export type { BaseDuration, Tuplet, Duration } from './duration.js';
export {
  TICKS_PER_QUARTER,
  computeTicks,
  makeDuration,
  durationToTicks,
} from './duration.js';

// --- timeSignature ---
export type { TimeSignature } from './timeSignature.js';
export {
  FOUR_FOUR,
  THREE_FOUR,
  SIX_EIGHT,
  ticksPerBar,
  makeTimeSignature,
} from './timeSignature.js';

// --- neckPosition ---
export type { NeckPosition } from './neckPosition.js';
export { makeNeckPosition } from './neckPosition.js';

// --- interval ---
export type { IntervalSize, IntervalQuality, Interval } from './interval.js';
export { intervalBetween } from './interval.js';

// --- key ---
export type { Mode, Key, KeySignature } from './key.js';
export { keySignature, diatonicScale, scaleDegreeOf, ALL_KEYS } from './key.js';

// --- chord ---
export type {
  TriadQuality,
  SeventhQuality,
  ChordQuality,
  Chord,
} from './chord.js';
export { chordTones, romanNumeralToChord } from './chord.js';

// --- line ---
export type {
  ChordToneRole,
  LineNote,
  Line,
  ConcreteProgression,
  PhrasePattern,
  PhraseStructure,
  ContourShape,
  ContourTarget,
  RhythmicMotifPlan,
} from './line.js';
