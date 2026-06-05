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
import { readFile, writeFile, mkdir } from 'node:fs/promises';

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

void app.whenReady().then(() => {
  console.log('[MAIN] app ready; creating window');
  registerConfigIpc();
  createWindow();

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
