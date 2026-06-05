// Barrel for the persistence layer (Milestone 5). NODE / Electron-main only:
// the driver is Node's built-in `node:sqlite`, which must NOT be imported by any
// pure module or the renderer (the renderer reaches the DB via IPC). Types and
// values are re-exported separately because verbatimModuleSyntax requires
// `export type` for type-only symbols.

// --- db (open + migrations runner; the DI seam) ---
export type { Db } from './db.js';
export {
  openDatabase,
  openInMemory,
  runMigrations,
  DEFAULT_MIGRATIONS_DIR,
} from './db.js';

// --- sessions DAO ---
export type { SessionRow, StartSessionArgs } from './sessions.js';
export { insertSession, endSession, getSession } from './sessions.js';

// --- line_attempts DAO ---
export type {
  AttemptType,
  AttemptDimensions,
  InsertAttemptArgs,
} from './lineAttempts.js';
export {
  deriveDimensions,
  insertLineAttempt,
  getLineAttempt,
} from './lineAttempts.js';

// --- note_events DAO ---
export { insertNoteEvents, getNoteEvents } from './noteEvents.js';

// --- presets DAO ---
export type { PresetRow, Preset, SavePresetArgs } from './presets.js';
export {
  savePreset,
  loadPreset,
  listPresets,
  usePreset,
  deletePreset,
} from './presets.js';

// --- stats queries (Milestone 5 views) ---
export type {
  AccuracyFilter,
  AccuracyPoint,
  KeyOption,
  PositionOption,
  HeatmapFilter,
  PitchHeatmapBucket,
} from './stats.js';
export {
  accuracyOverTime,
  availableKeys,
  availablePositions,
  missedNoteHeatmap,
} from './stats.js';
