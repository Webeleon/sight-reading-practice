// statsBridge.ts — renderer-side typed accessor for the stats IPC (Milestone 5).
//
// Disposable UI layer. The renderer NEVER imports the persistence layer or the
// SQLite driver (main-process only). Instead it calls the preload
// bridge (window.sightReading.stats), which round-trips to the main-process DB
// and returns plain JSON. These functions:
//   * expose typed wrappers over the IPC channels,
//   * narrow the `unknown[]` IPC payload into the result interfaces, and
//   * return [] outside Electron (the `npm run dev` browser preview) so the
//     StatsView still renders (empty) rather than throwing.
//
// The result interfaces below MIRROR the ones in src/persistence/stats.ts. They
// are duplicated (not imported) on purpose: importing from persistence would drag
// the native module into the renderer tsconfig. The persistence test is the
// single source of truth that the SHAPES match.

import './appConfig.js'; // ensures Window.sightReading is declared once

/** Filter bag for both stats queries (mirrors AccuracyFilter/HeatmapFilter). */
export interface StatsFilter {
  keyTonic?: string;
  keyMode?: string;
  positionFretLow?: number;
  positionFretHigh?: number;
  sessionId?: string;
}

/** One point in the accuracy time-series (mirrors AccuracyPoint). */
export interface AccuracyPoint {
  attemptId: string;
  startedAt: number;
  pitchAccuracy: number | null;
  timingAccuracy: number | null;
  keyTonic: string;
  keyMode: string;
  positionLabel: string | null;
  positionFretLow: number;
  positionFretHigh: number;
  tempoConfigured: number;
}

/** One aggregated pitch bucket for the heatmap (mirrors PitchHeatmapBucket). */
export interface PitchHeatmapBucket {
  expectedMidi: number;
  expectedPitchName: string | null;
  total: number;
  hits: number;
  missed: number;
  wrongPitch: number;
  late: number;
  missRate: number;
}

/** Distinct key option for the filter dropdown (mirrors KeyOption). */
export interface KeyOption {
  keyTonic: string;
  keyMode: string;
}

/** Distinct position option for the filter dropdown (mirrors PositionOption). */
export interface PositionOption {
  positionLabel: string | null;
  positionFretLow: number;
  positionFretHigh: number;
}

/** The stats slice of the preload bridge (typed view of window.sightReading). */
interface StatsBridge {
  accuracyOverTime: (filter?: StatsFilter) => Promise<unknown[]>;
  missedNoteHeatmap: (filter?: StatsFilter) => Promise<unknown[]>;
  availableKeys: () => Promise<unknown[]>;
  availablePositions: () => Promise<unknown[]>;
}

function bridge(): StatsBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const sr = window.sightReading as
    | (Window['sightReading'] & { stats?: StatsBridge })
    | undefined;
  return sr?.stats;
}

/** Whether the stats IPC surface is present (i.e. running inside Electron). */
export function statsAvailable(): boolean {
  return bridge() !== undefined;
}

export async function fetchAccuracyOverTime(
  filter: StatsFilter = {},
): Promise<AccuracyPoint[]> {
  const b = bridge();
  if (!b) return [];
  return (await b.accuracyOverTime(filter)) as AccuracyPoint[];
}

export async function fetchMissedNoteHeatmap(
  filter: StatsFilter = {},
): Promise<PitchHeatmapBucket[]> {
  const b = bridge();
  if (!b) return [];
  return (await b.missedNoteHeatmap(filter)) as PitchHeatmapBucket[];
}

export async function fetchAvailableKeys(): Promise<KeyOption[]> {
  const b = bridge();
  if (!b) return [];
  return (await b.availableKeys()) as KeyOption[];
}

export async function fetchAvailablePositions(): Promise<PositionOption[]> {
  const b = bridge();
  if (!b) return [];
  return (await b.availablePositions()) as PositionOption[];
}
