// Line & LineNote: the generated melodic line. Every type here must be
// JSON.stringify round-trip safe (it persists to SQLite and transfers to Swift
// Codable later) — so: no class instances, no functions, no Map/Set, optional
// fields omitted rather than set to undefined.
//
// IMPORTANT: the generator-shape interfaces that Line references
// (ConcreteProgression, PhraseStructure, ContourTarget, RhythmicMotifPlan) are
// declared HERE, in /domain, on purpose. Line needs their shapes, and the
// generator produces them; declaring them in /generator would create a
// domain -> generator import cycle. /domain stays dependency-free; /generator
// imports these from here.

import type { Pitch } from './pitch.js';
import type { Duration } from './duration.js';
import type { Key } from './key.js';
import type { TimeSignature } from './timeSignature.js';
import type { NeckPosition } from './neckPosition.js';
import type { Chord } from './chord.js';

export type ChordToneRole =
  | 'root'
  | 'third'
  | 'fifth'
  | 'seventh'
  | 'passing'
  | 'neighbor'
  | 'appoggiatura'
  | 'escape'
  | 'chromatic'
  | 'chordTone'
  | 'nonChordTone';

export interface LineNote {
  pitch: Pitch | null; // null = rest
  duration: Duration;
  startTick: number; // absolute from line start
  barIndex: number;
  beatPositionInBar: number; // tick offset within the bar
  isStrongBeat: boolean;
  impliedChord: Chord;
  chordToneRole: ChordToneRole;
  tiedToNext: boolean;
}

// --- Generator-shape interfaces (co-located to avoid an import cycle) ---------

/** A progression with its Roman numerals already instantiated into concrete
 *  chords in the line's key (with correct enharmonic spelling). */
export interface ConcreteProgression {
  progressionId: string;
  chords: Array<{
    romanNumeral: string; // key-agnostic, e.g. 'ii', 'V7'
    chord: Chord; // concrete, spelled in the line's key
    barIndex: number;
    startTick: number; // 0 = downbeat of that bar
  }>;
}

export type PhrasePattern = 'AAAB' | 'ABAB' | 'ABAC' | 'throughComposed';

/** Which repetition/contrast template the phrase follows, and the role of each
 *  bar (e.g. ['A','A','A','B']). For throughComposed barRoles are all distinct. */
export interface PhraseStructure {
  pattern: PhrasePattern;
  barRoles: string[]; // length === barCount
}

export type ContourShape =
  | 'arch'
  | 'invertedArch'
  | 'ascending'
  | 'descending'
  | 'steady';

/** The melodic shape plan: overall shape, where/what the climax is, and a
 *  per-bar pitch target the strong-beat placer aims toward. */
export interface ContourTarget {
  shape: ContourShape;
  climaxBar: number; // 0-based bar index of the high point
  climaxPitch: Pitch;
  perBarTargets: Pitch[]; // length === barCount
}

/** Rhythm assignment: which motif id fills each bar, plus any subtle variations
 *  applied (displacement / augmentation / omission). Kept JSON-safe and minimal. */
export interface RhythmicMotifPlan {
  perBarMotifIds: string[]; // length === barCount
  variations: Array<{
    barIndex: number;
    kind: 'displacement' | 'augmentation' | 'omission';
  }>;
}

export interface Line {
  id: string; // UUID
  seed: number;
  generatedAt: string; // ISO 8601
  key: Key;
  timeSignature: TimeSignature;
  position: NeckPosition;
  tempo: number;
  barCount: number;
  progression: ConcreteProgression;
  phraseStructure: PhraseStructure;
  contourTarget: ContourTarget;
  rhythmicMotifPlan: RhythmicMotifPlan;
  notes: LineNote[];
  generatorVersion: string;
  validationsPassed: string[];
}
