// useLiveInputLevel — an always-on live input level for the meter/needle, so you
// can play and watch the needle ANY time, not only while a take is running.
//
// Owns a single InputLevelMonitor (one getUserMedia tap) while `active`, polls its
// smoothed RMS once per animation frame, and returns it. Releases the mic when
// `active` flips false — which is how the caller hands the device over to a take's
// own audio graph (App passes active = inPractice && !isRunning). Re-acquires on
// device change. Returns 0 while inactive.

import { useEffect, useState } from 'react';
import { InputLevelMonitor } from '../audio/index.js';
import { getAudioContext } from './audioContext.js';

export function useLiveInputLevel(
  deviceId: string | undefined,
  active: boolean,
): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let rafId = 0;
    let stopped = false;
    const monitor = new InputLevelMonitor(getAudioContext());
    monitor
      .start(deviceId)
      .then(() => {
        const loop = (): void => {
          if (stopped) return;
          setLevel(monitor.getLevel());
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      })
      .catch((err: unknown) => {
        console.warn('[UI] live input monitor failed to start', err);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      monitor.stop();
    };
  }, [deviceId, active]);

  return level;
}
