// Shared renderer AudioContext accessor. The take hooks (useSightReading,
// useReadAlong) lazily create one AudioContext on the `__sr_audioCtx` window key;
// this exposes the SAME singleton so the mic-check monitor taps the one context
// the rest of the app already uses (browsers cap how many you can open).

/** Lazily create / return the one shared renderer AudioContext (resume on gesture). */
export function getAudioContext(): AudioContext {
  const w = window as unknown as { __sr_audioCtx?: AudioContext };
  if (!w.__sr_audioCtx) {
    w.__sr_audioCtx = new AudioContext();
    console.log(`[AUDIO] created AudioContext (sampleRate=${w.__sr_audioCtx.sampleRate})`);
  }
  return w.__sr_audioCtx;
}
