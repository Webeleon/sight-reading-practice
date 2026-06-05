// appConfig.ts — renderer-side accessor for the small persisted config.
//
// Disposable UI layer. In Electron the config round-trips through the preload
// bridge (window.sightReading.config) to a JSON file in userData. Outside
// Electron (the `npm run dev` browser preview / a plain page) we fall back to
// localStorage so the device picker + headphone tip still persist for dev.

/** The persisted renderer config (mirrors AppConfig in electron/preload.ts). */
export interface AppConfig {
  inputDeviceId?: string;
  headphoneTipDismissed?: boolean;
}

interface ConfigBridge {
  get: () => Promise<AppConfig>;
  set: (patch: AppConfig) => Promise<AppConfig>;
}

interface SightReadingBridge {
  isElectron: boolean;
  versions: { electron: string; chrome: string; node: string };
  config?: ConfigBridge;
}

declare global {
  interface Window {
    sightReading?: SightReadingBridge;
  }
}

const LS_KEY = 'sr-config';

function localStorageGet(): AppConfig {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AppConfig) : {};
  } catch {
    return {};
  }
}

function localStorageSet(patch: AppConfig): AppConfig {
  const merged: AppConfig = { ...localStorageGet(), ...patch };
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable; config is ephemeral this run */
  }
  return merged;
}

/** Read the persisted config (Electron IPC, else localStorage fallback). */
export async function getAppConfig(): Promise<AppConfig> {
  const bridge =
    typeof window !== 'undefined' ? window.sightReading?.config : undefined;
  if (bridge) return bridge.get();
  return localStorageGet();
}

/** Merge a patch into the persisted config and return the merged result. */
export async function setAppConfig(patch: AppConfig): Promise<AppConfig> {
  const bridge =
    typeof window !== 'undefined' ? window.sightReading?.config : undefined;
  if (bridge) return bridge.set(patch);
  return localStorageSet(patch);
}
