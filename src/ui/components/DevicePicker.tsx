// DevicePicker — choose + persist the audio input device (brief section 12).
//
// Disposable UI layer. Enumerates audio input devices, lets the user pick one,
// and persists the choice (via the appConfig bridge -> Electron userData file, or
// localStorage in the browser preview). On mount it requests mic permission once
// (so device LABELS populate) and restores the saved device.

import React, { useCallback, useEffect, useState } from 'react';
import {
  enumerateInputDevices,
  ensureMicPermission,
  type AudioInputDevice,
} from '../../audio/index.js';
import { getAppConfig, setAppConfig } from '../appConfig.js';

export interface DevicePickerProps {
  /** Current selected deviceId (controlled by App), or undefined for default. */
  deviceId: string | undefined;
  disabled: boolean;
  /** Called when the user picks a device (App persists + uses it). */
  onChange: (deviceId: string | undefined) => void;
}

export function DevicePicker({
  deviceId,
  disabled,
  onChange,
}: DevicePickerProps): React.JSX.Element {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown',
  );

  const refresh = useCallback(async (): Promise<void> => {
    const ok = await ensureMicPermission();
    setPermission(ok ? 'granted' : 'denied');
    const list = await enumerateInputDevices();
    setDevices(list);
    console.log(`[UI] device picker: ${list.length} input(s), permission=${ok}`);
  }, []);

  // On mount: restore saved device, then enumerate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await getAppConfig();
      if (!cancelled && cfg.inputDeviceId) {
        console.log(`[UI] restored saved input device: ${cfg.inputDeviceId}`);
        onChange(cfg.inputDeviceId);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    (value: string): void => {
      const next = value === '' ? undefined : value;
      onChange(next);
      void setAppConfig({ inputDeviceId: next });
      console.log(`[UI] input device selected + persisted: ${next ?? '(default)'}`);
    },
    [onChange],
  );

  return (
    <div className="device-picker">
      <label>
        Audio input
        <select
          disabled={disabled}
          value={deviceId ?? ''}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn btn-small"
        onClick={() => void refresh()}
        disabled={disabled}
        title="Re-scan input devices"
      >
        Rescan
      </button>
      {permission === 'denied' && (
        <span className="device-warn">
          Mic permission denied — pitch detection will not work.
        </span>
      )}
    </div>
  );
}
