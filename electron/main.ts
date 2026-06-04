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

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      preload: join(__dirname, '../preload/preload.mjs'),
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
    const indexHtml = join(__dirname, '../renderer/index.html');
    console.log(`[MAIN] loading built renderer: ${indexHtml}`);
    void win.loadFile(indexHtml);
  }
}

void app.whenReady().then(() => {
  console.log('[MAIN] app ready; creating window');
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
