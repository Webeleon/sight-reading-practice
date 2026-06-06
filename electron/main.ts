// Electron main process.
//
// Disposable layer (brief section 2): may use Electron/Node APIs freely. Keep it tiny —
// create one BrowserWindow, load the renderer (the electron-vite dev server in dev, the
// built index.html in prod), enable contextIsolation, and disable nodeIntegration in the
// renderer. The renderer talks to nothing privileged yet; the preload (see preload.ts)
// is a contextBridge stub for when persistence/audio IPC arrives in later milestones.
//
// Logging uses the [MAIN] prefix (brief section 16 lists [UI]/[AUDIO]/etc.; main-process
// lifecycle gets its own tag so it is distinguishable from renderer logs).

import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Db } from '../src/persistence/index.js';
import type { Line } from '../src/domain/index.js';
import type { EvaluationResult } from '../src/evaluation/index.js';
import type { AttemptType } from '../src/persistence/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Tiny config persistence (Milestone 4 device picker).
//
// The renderer cannot touch the filesystem (contextIsolation + no nodeIntegration),
// so it asks the main process to read/write a small JSON config in the app's
// userData dir. This is NOT the SQLite database (that's Milestone 5) — just a
// throwaway key/value file so the chosen audio input device persists across runs.
// Shape: { inputDeviceId?: string; headphoneTipDismissed?: boolean }.
// ----------------------------------------------------------------------------

/** The persisted renderer config. Kept deliberately small + permissive. */
interface AppConfig {
  /** enumerateDevices deviceId of the chosen audio input, if any. */
  inputDeviceId?: string;
  /** Whether the user has dismissed the one-time headphone tip. */
  headphoneTipDismissed?: boolean;
  /** Selected pitch detector ('pitchy' default | 'crepe'), persisted for A/B. */
  detector?: 'pitchy' | 'crepe';
  /** Whether the first-run onboarding/setup screen has been completed. */
  onboardingComplete?: boolean;
}

function configPath(): string {
  return join(app.getPath('userData'), 'sr-config.json');
}

async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      console.log(`[MAIN] config read from ${configPath()}`);
      return parsed as AppConfig;
    }
    return {};
  } catch {
    // No file yet (first run) or unreadable — start from an empty config.
    return {};
  }
}

async function writeConfig(next: AppConfig): Promise<void> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8');
  console.log(`[MAIN] config written to ${configPath()}: ${JSON.stringify(next)}`);
}

function registerConfigIpc(): void {
  // Read the whole config object.
  ipcMain.handle('config:get', async (): Promise<AppConfig> => readConfig());
  // Merge a patch into the config and persist; returns the merged result.
  ipcMain.handle(
    'config:set',
    async (_event, patch: AppConfig): Promise<AppConfig> => {
      const current = await readConfig();
      const merged: AppConfig = { ...current, ...(patch ?? {}) };
      await writeConfig(merged);
      return merged;
    },
  );
}

// ----------------------------------------------------------------------------
// SQLite persistence (Milestone 5) — initialized LAZILY and GRACEFULLY.
//
// The driver is Node's BUILT-IN `node:sqlite` (see src/persistence/db.ts), so there
// is NO native-module ABI mismatch to manage: the same code loads under vitest and
// inside the Electron main process with no rebuild step. We still open the DB inside
// a try/catch and DEGRADE GRACEFULLY: if opening or migrating the DB fails for any
// reason (e.g. a corrupt/locked file), we log a clear [DB] warning and disable
// persistence (db stays null) so the read-along + evaluation UX still launches.
//   * load the persistence module DYNAMICALLY inside a try/catch (first DB use),
//   * on failure, log a [DB] warning and DISABLE persistence (db stays null),
//   * keep the app fully launchable + usable read-along either way.
// ----------------------------------------------------------------------------

/** The live DB once opened, or null if persistence is disabled/unavailable. */
let db: Db | null = null;
/** Whether we already tried (and possibly failed) to open the DB — so we warn once. */
let dbInitAttempted = false;
/** The id of the session the renderer started this run (if any), so before-quit
 *  can stamp ended_at even when the window closes without a clean session:end
 *  (e.g. the user Cmd+Q's mid-attempt). Cleared once ended. */
let activeSessionId: string | null = null;

/** Candidate locations of the numbered-migrations folder, tried in order. In dev
 *  the source tree is alongside the project root; the first that exists wins. */
function resolveMigrationsDir(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'src/persistence/migrations'),
    join(process.cwd(), 'src/persistence/migrations'),
    join(moduleDir, '../../src/persistence/migrations'),
    join(moduleDir, 'migrations'),
  ];
  return candidates.find((c) => existsSync(c));
}

/**
 * Lazily open the SQLite DB (idempotent). Returns the Db, or null if opening or
 * migrating failed — in which case persistence is silently disabled and the app
 * keeps running.
 */
async function getDb(): Promise<Db | null> {
  if (db) return db;
  if (dbInitAttempted) return db; // already failed once; don't spam
  dbInitAttempted = true;

  try {
    // Dynamic import so any load/open failure is catchable here rather than
    // crashing the whole main process at startup.
    const persistence = await import('../src/persistence/index.js');
    const dbPath = join(app.getPath('userData'), 'sight-reading.db');
    const migrationsDir = resolveMigrationsDir();
    if (!migrationsDir) {
      console.warn(
        '[DB] could not locate migrations folder; persistence disabled. ' +
          'Expected src/persistence/migrations to ship with the app.',
      );
      return null;
    }
    db = persistence.openDatabase(dbPath, migrationsDir);
    console.log(`[DB] persistence ready (${dbPath})`);
    return db;
  } catch (err) {
    console.warn(
      '[DB] failed to initialize SQLite (persistence DISABLED). The app will run ' +
        'read-along without saving. Underlying error:',
      err,
    );
    db = null;
    return null;
  }
}

/** Close the DB on shutdown if it was opened. */
function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] closed');
  }
}

// electron-vite injects ELECTRON_RENDERER_URL in dev (the Vite dev server address).
// In a packaged/prod build it is undefined and we load the built HTML from disk.
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Sight Reading',
    backgroundColor: '#15171c',
    show: false,
    webPreferences: {
      // Secure defaults: isolate the renderer from Node, expose only what preload chooses.
      preload: join(moduleDir, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses ESM/Node require for the bridge; fine for a prototype
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  if (RENDERER_DEV_URL) {
    console.log(`[MAIN] loading renderer dev server: ${RENDERER_DEV_URL}`);
    void win.loadURL(RENDERER_DEV_URL);
    win.webContents.openDevTools({ mode: 'right' });
  } else {
    const indexHtml = join(moduleDir, '../renderer/index.html');
    console.log(`[MAIN] loading built renderer: ${indexHtml}`);
    void win.loadFile(indexHtml);
  }
}

/** A tiny DB-availability IPC so the renderer can show whether saving is on. */
function registerDbIpc(): void {
  ipcMain.handle('db:status', async (): Promise<{ available: boolean }> => {
    const handle = await getDb();
    return { available: handle !== null };
  });
}

// ----------------------------------------------------------------------------
// Stats IPC (Milestone 5 stats views).
//
// The renderer NEVER touches the SQLite driver. It asks the main process to run the
// read-only stats queries (src/persistence/stats.ts) and gets back plain JSON.
// Each handler lazily resolves the DB (getDb) and returns an empty result when
// persistence is disabled, so the stats view degrades gracefully instead of
// throwing. The query functions themselves are pure DI (db + filter) — see
// stats.ts. The filter object travels verbatim from the renderer.
// ----------------------------------------------------------------------------

/** The persistence surface (stats + DAOs), loaded dynamically alongside the DB so
 *  any load/open failure stays catchable in getDb(). */
type PersistenceModule = typeof import('../src/persistence/index.js');

/** Cached once loaded, so before-quit (which is SYNC) can end the active session
 *  without awaiting a dynamic import. */
let persistenceModule: PersistenceModule | null = null;

async function loadStats(): Promise<PersistenceModule | null> {
  const handle = await getDb();
  if (!handle) return null;
  if (persistenceModule) return persistenceModule;
  try {
    persistenceModule = await import('../src/persistence/index.js');
    return persistenceModule;
  } catch (err) {
    console.warn('[DB] failed to load persistence module:', err);
    return null;
  }
}

function registerStatsIpc(): void {
  // The filter shape is intentionally permissive (a plain bag) — it maps 1:1 to
  // AccuracyFilter/HeatmapFilter in stats.ts. We pass it straight through.
  type Filter = Record<string, string | number> | undefined;

  ipcMain.handle(
    'stats:accuracyOverTime',
    async (_e, filter: Filter): Promise<unknown[]> => {
      const stats = await loadStats();
      const handle = await getDb();
      if (!stats || !handle) return [];
      return stats.accuracyOverTime(handle, filter ?? {});
    },
  );

  ipcMain.handle(
    'stats:missedNoteHeatmap',
    async (_e, filter: Filter): Promise<unknown[]> => {
      const stats = await loadStats();
      const handle = await getDb();
      if (!stats || !handle) return [];
      return stats.missedNoteHeatmap(handle, filter ?? {});
    },
  );

  ipcMain.handle('stats:availableKeys', async (): Promise<unknown[]> => {
    const stats = await loadStats();
    const handle = await getDb();
    if (!stats || !handle) return [];
    return stats.availableKeys(handle);
  });

  ipcMain.handle('stats:availablePositions', async (): Promise<unknown[]> => {
    const stats = await loadStats();
    const handle = await getDb();
    if (!stats || !handle) return [];
    return stats.availablePositions(handle);
  });
}

// ----------------------------------------------------------------------------
// Session-loop WRITE IPC (Milestone 5) — the treadmill's persistence side.
//
// The renderer NEVER imports the SQLite driver or the persistence DAOs (they are
// main-process only). It calls these channels, which lazily resolve the DB and
// invoke the DAOs (src/persistence/sessions|lineAttempts|noteEvents). All write
// handlers DEGRADE GRACEFULLY: when persistence is disabled they return
// { persisted: false } instead of throwing, so the read-along loop keeps running.
// The renderer treats a false result as "saving is off".
//
// The Line + EvaluationResult travel verbatim as plain JSON over IPC (both are
// JSON.stringify-round-trip-safe by design — see domain/line.ts). The main
// process supplies the trusted server-side fields (app_version, the clock for
// started_at / ended_at / completed_at) rather than trusting the renderer's clock.
// ----------------------------------------------------------------------------

/** Whether a write actually hit the DB (false = persistence disabled). */
interface PersistAck {
  persisted: boolean;
}

/** Payload the renderer sends to start a session. The main process stamps
 *  started_at and app_version; the renderer owns the id (a UUID) + config. */
interface StartSessionPayload {
  id: string;
  configSnapshot: unknown;
}

/** Payload to write one completed attempt + its note_events in one round-trip. */
interface WriteAttemptPayload {
  id: string;
  sessionId: string;
  lineIndexInSession: number;
  attemptType: AttemptType;
  parentAttemptId?: string | null;
  /** epoch ms when the count-in finished / attempt began (renderer's clock; this
   *  one IS the renderer's because it is a musical-time anchor, not a save time). */
  startedAt: number;
  /** epoch ms when the attempt finished. */
  completedAt: number;
  durationMs: number;
  line: Line;
  musicxml: string;
  result: EvaluationResult;
}

function registerSessionIpc(): void {
  // Start a session: one sessions row, ended_at NULL until session:end.
  ipcMain.handle(
    'session:start',
    async (_e, payload: StartSessionPayload): Promise<PersistAck> => {
      const p = await loadStats(); // same dynamic-import seam as stats
      const handle = await getDb();
      if (!p || !handle) return { persisted: false };
      p.insertSession(handle, {
        id: payload.id,
        startedAt: Date.now(),
        appVersion: app.getVersion(),
        configSnapshot: payload.configSnapshot,
      });
      activeSessionId = payload.id;
      return { persisted: true };
    },
  );

  // End a session: stamp ended_at (idempotent).
  ipcMain.handle(
    'session:end',
    async (_e, id: string): Promise<PersistAck> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return { persisted: false };
      p.endSession(handle, id, Date.now());
      if (activeSessionId === id) activeSessionId = null;
      return { persisted: true };
    },
  );

  // Write one COMPLETED attempt: line_attempts row (dims derived from the Line)
  // PLUS one note_events row per expected note + extras. Both writes are wrapped
  // so a single failure does not half-write; insertNoteEvents already runs in its
  // own transaction.
  ipcMain.handle(
    'attempt:write',
    async (_e, payload: WriteAttemptPayload): Promise<PersistAck> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return { persisted: false };
      const write = handle.transaction((): void => {
        p.insertLineAttempt(handle, {
          id: payload.id,
          sessionId: payload.sessionId,
          lineIndexInSession: payload.lineIndexInSession,
          attemptType: payload.attemptType,
          parentAttemptId: payload.parentAttemptId ?? null,
          startedAt: payload.startedAt,
          completedAt: payload.completedAt,
          durationMs: payload.durationMs,
          line: payload.line,
          musicxml: payload.musicxml,
          result: payload.result,
        });
        p.insertNoteEvents(handle, payload.id, payload.line, payload.result);
      });
      write();
      return { persisted: true };
    },
  );
}

// ----------------------------------------------------------------------------
// Preset IPC (Milestone 5) — save / load / list / use / delete named configs.
//
// Same DI + graceful-degradation pattern. usePreset bumps use_count and stamps
// last_used_at (the main process supplies `now`). Reads return [] / null when
// persistence is disabled so the UI degrades rather than throws.
// ----------------------------------------------------------------------------

interface SavePresetPayload {
  id: string;
  name: string;
  config: unknown;
}

function registerPresetIpc(): void {
  ipcMain.handle(
    'preset:save',
    async (_e, payload: SavePresetPayload): Promise<PersistAck> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return { persisted: false };
      p.savePreset(handle, {
        id: payload.id,
        name: payload.name,
        config: payload.config,
        now: Date.now(),
      });
      return { persisted: true };
    },
  );

  ipcMain.handle(
    'preset:load',
    async (_e, id: string): Promise<unknown | null> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return null;
      return p.loadPreset(handle, id) ?? null;
    },
  );

  ipcMain.handle('preset:list', async (): Promise<unknown[]> => {
    const p = await loadStats();
    const handle = await getDb();
    if (!p || !handle) return [];
    return p.listPresets(handle);
  });

  ipcMain.handle(
    'preset:use',
    async (_e, id: string): Promise<unknown | null> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return null;
      return p.usePreset(handle, id, Date.now()) ?? null;
    },
  );

  ipcMain.handle(
    'preset:delete',
    async (_e, id: string): Promise<{ deleted: boolean }> => {
      const p = await loadStats();
      const handle = await getDb();
      if (!p || !handle) return { deleted: false };
      return { deleted: p.deletePreset(handle, id) };
    },
  );
}

void app.whenReady().then(() => {
  console.log('[MAIN] app ready; creating window');
  registerConfigIpc();
  registerDbIpc();
  registerStatsIpc();
  registerSessionIpc();
  registerPresetIpc();
  createWindow();

  // Warm up persistence lazily but eagerly-at-ready: this triggers the guarded
  // open so the [DB] warning (if any) shows once at launch rather than on first
  // write. A failure here NEVER prevents the window/read-along from running.
  void getDb();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS where apps stay alive until Cmd+Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On shutdown: stamp ended_at on the still-open session (best-effort — the user
// may have Cmd+Q'd mid-attempt without a clean session:end), then flush + close
// the DB. before-quit is SYNC, so we use the already-loaded persistenceModule +
// open db handle rather than the async getDb()/loadStats() seam.
app.on('before-quit', () => {
  if (db && persistenceModule && activeSessionId) {
    try {
      persistenceModule.endSession(db, activeSessionId, Date.now());
    } catch (err) {
      console.warn('[DB] before-quit: failed to end active session', err);
    }
    activeSessionId = null;
  }
  closeDb();
});
