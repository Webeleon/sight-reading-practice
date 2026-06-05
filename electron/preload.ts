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
} as const;

export type SightReadingApi = typeof api;

contextBridge.exposeInMainWorld('sightReading', api);

console.log('[MAIN] preload bridge exposed (window.sightReading)');
