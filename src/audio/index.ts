// Barrel for the audio layer (Milestone 3 part: musical-time model + metronome).
// musicalTime is PURE TypeScript (no Web Audio / DOM); metronome is the Web Audio
// layer. Type-only symbols are re-exported with `export type` (verbatimModuleSyntax).

// --- musical time (pure) ---
export type { ScheduleEntry, MetronomeClick, Schedule } from './musicalTime.js';
export {
  DEFAULT_COUNT_IN_BARS,
  tickToMs,
  precomputeSchedule,
  currentNoteIndexAt,
  computeBeatClicks,
} from './musicalTime.js';

// --- metronome (Web Audio) ---
export type {
  MetronomeTick,
  AudioClock,
  MetronomeOptions,
} from './metronome.js';
export {
  Metronome,
  createMetronome,
  LOOKAHEAD_MS,
  SCHEDULER_INTERVAL_MS,
} from './metronome.js';
