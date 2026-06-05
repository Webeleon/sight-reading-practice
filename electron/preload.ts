// Electron preload script.
//
// Runs in an isolated context bridging the privileged main process and the sandboxed
// renderer. contextIsolation is ON (see main.ts), so the renderer cannot reach Node or
// Electron directly — anything it needs must be deliberately exposed here via
// contextBridge.exposeInMainWorld.
//
// Milestone 3 needs NO privileged surface (no persistence/IPC yet). We expose a tiny,
// safe, read-only descriptor so the renderer can confirm the preload loaded and so there
// is an obvious place to add IPC channels (db writes, device config) in later milestones.
// Nothing dangerous (no ipcRenderer passthrough, no require, no fs) is exposed.

import { contextBridge, ipcRenderer } from 'electron';

/** The small persisted renderer config (mirrors AppConfig in main.ts). */
export interface AppConfig {
  /** enumerateDevices deviceId of the chosen audio input, if any. */
  inputDeviceId?: string;
  /** Whether the user has dismissed the one-time headphone tip. */
  headphoneTipDismissed?: boolean;
  /** Selected pitch detector ('pitchy' default | 'crepe'), persisted for A/B. */
  detector?: 'pitchy' | 'crepe';
}

/** Filter bag passed to the stats queries; mirrors AccuracyFilter/HeatmapFilter
 *  in src/persistence/stats.ts. All fields optional + ANDed. */
export interface StatsFilter {
  keyTonic?: string;
  keyMode?: string;
  positionFretLow?: number;
  positionFretHigh?: number;
  sessionId?: string;
}

/** attempt_type values (brief sections 11/13). Mirrors AttemptType in the
 *  persistence layer; duplicated so the preload does not import the native module. */
export type AttemptType = 'first_read' | 'retry_at_tempo' | 'retry_slower';

/** Whether a write actually hit the DB (false = persistence disabled). */
export interface PersistAck {
  persisted: boolean;
}

/** Payload to start a session. main stamps started_at + app_version. */
export interface StartSessionPayload {
  id: string;
  configSnapshot: unknown;
}

/** Payload to write one completed attempt + its note_events (Line +
 *  EvaluationResult travel as plain JSON; both are round-trip-safe). The shapes of
 *  `line` / `result` are kept opaque here to avoid importing domain/evaluation
 *  into the preload — the renderer passes its own typed objects through. */
export interface WriteAttemptPayload {
  id: string;
  sessionId: string;
  lineIndexInSession: number;
  attemptType: AttemptType;
  parentAttemptId?: string | null;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  line: unknown;
  musicxml: string;
  result: unknown;
}

/** Payload to save a named preset config. */
export interface SavePresetPayload {
  id: string;
  name: string;
  config: unknown;
}

const api = {
  /** Marker so the renderer can verify the secure preload bridge is live. */
  isElectron: true,
  /** Versions, handy for logging / future IPC negotiation. Read-only snapshot. */
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /**
   * Tiny config persistence (Milestone 4 device picker). The renderer cannot
   * touch the filesystem, so it round-trips through the main process, which keeps
   * a small JSON file in userData. NOT the SQLite DB (that is Milestone 5).
   */
  config: {
    /** Read the whole persisted config (empty object on first run). */
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    /** Merge a patch into the config, persist it, return the merged result. */
    set: (patch: AppConfig): Promise<AppConfig> =>
      ipcRenderer.invoke('config:set', patch),
  },
  /**
   * Read-only stats queries (Milestone 5 views). The renderer NEVER touches the
   * SQLite driver; it calls these, which round-trip to the main-process DB and
   * return plain JSON. Each resolves to an empty array when persistence is
   * disabled, so the stats view degrades gracefully.
   */
  stats: {
    /** Pitch & timing accuracy over time for first_read attempts (filterable). */
    accuracyOverTime: (filter?: StatsFilter): Promise<unknown[]> =>
      ipcRenderer.invoke('stats:accuracyOverTime', filter),
    /** Per-pitch missed/wrong heatmap over first_read note_events (filterable). */
    missedNoteHeatmap: (filter?: StatsFilter): Promise<unknown[]> =>
      ipcRenderer.invoke('stats:missedNoteHeatmap', filter),
    /** Distinct (key_tonic, key_mode) pairs present among first_read attempts. */
    availableKeys: (): Promise<unknown[]> =>
      ipcRenderer.invoke('stats:availableKeys'),
    /** Distinct position fret-windows present among first_read attempts. */
    availablePositions: (): Promise<unknown[]> =>
      ipcRenderer.invoke('stats:availablePositions'),
  },
  /**
   * Session-loop WRITE surface (Milestone 5). The renderer drives the treadmill:
   * start a session on launch, write each COMPLETED attempt (+ its note_events),
   * end the session on quit. Every call returns { persisted } so the renderer can
   * tell whether saving is live (false when persistence is disabled / browser
   * preview). The DB itself lives in the main process — the renderer never touches
   * the SQLite driver.
   */
  session: {
    /** Begin a session: one sessions row (ended_at NULL). main stamps the clock. */
    start: (payload: StartSessionPayload): Promise<PersistAck> =>
      ipcRenderer.invoke('session:start', payload),
    /** Stamp ended_at on a session (idempotent). */
    end: (id: string): Promise<PersistAck> =>
      ipcRenderer.invoke('session:end', id),
    /** Write one completed attempt: one line_attempts row + N note_events rows. */
    writeAttempt: (payload: WriteAttemptPayload): Promise<PersistAck> =>
      ipcRenderer.invoke('attempt:write', payload),
  },
  /**
   * Preset save/load (Milestone 5). usePreset bumps use_count + last_used_at.
   * Reads resolve to null/[] when persistence is disabled.
   */
  presets: {
    save: (payload: SavePresetPayload): Promise<PersistAck> =>
      ipcRenderer.invoke('preset:save', payload),
    load: (id: string): Promise<unknown | null> =>
      ipcRenderer.invoke('preset:load', id),
    list: (): Promise<unknown[]> => ipcRenderer.invoke('preset:list'),
    use: (id: string): Promise<unknown | null> =>
      ipcRenderer.invoke('preset:use', id),
    remove: (id: string): Promise<{ deleted: boolean }> =>
      ipcRenderer.invoke('preset:delete', id),
  },
} as const;

export type SightReadingApi = typeof api;

contextBridge.exposeInMainWorld('sightReading', api);

console.log('[MAIN] preload bridge exposed (window.sightReading)');
