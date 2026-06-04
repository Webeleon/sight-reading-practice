// Barrel for the fretboard module. Pure logic, depends only on domain.
// Type-only symbols are re-exported with `export type` (verbatimModuleSyntax).

// --- tuning ---
export { OPEN_STRING_MIDI, STRING_NUMBERS, openStringMidi } from './tuning.js';

// --- fretboardModel ---
export type { FretboardCell } from './fretboardModel.js';
export {
  MAX_FRET,
  midiAt,
  pitchClassAt,
  buildFretboardModel,
} from './fretboardModel.js';

// --- positionMapping ---
export type { StringFret, PlayablePitch } from './positionMapping.js';
export {
  computePlayablePitches,
  isPlayableInPosition,
} from './positionMapping.js';
