// DevicePicker — choose + persist the audio input device (brief section 12).
//
// Disposable UI layer. Enumerates audio input devices, lets the user pick one,
// and persists the choice (via the appConfig bridge -> Electron userData file, or
// localStorage in the browser preview). On mount it requests mic permission once
// (so device LABELS populate) and restores the saved device.
//
// PRESENTATION ONLY: restyled to the Signal Tape "MIC CHECK" treatment from
// design/app.html screen 01 (the dark .mic console card with a status readout).
// Behaviour is unchanged — same enumerate / select / persist / rescan / permission
// flow. The look is built from the global design tokens via inline styles (CSP
// allows style-src 'self' 'unsafe-inline'); no styles.css edits.

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

// ---- Signal Tape "MIC CHECK" inline-style fragments (design .onb .mic) ---------

const micCardStyle: React.CSSProperties = {
  border: '1.5px solid var(--ink)',
  borderRadius: 'var(--r)',
  background: '#14110e',
  color: 'var(--paper)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const micHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#b6b1a5',
};

const micRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const micSelectStyle: React.CSSProperties = {
  flex: '1 1 200px',
  fontFamily: 'var(--mono)',
  fontSize: 13,
  padding: '8px 9px',
  background: '#1d1916',
  color: 'var(--paper)',
  border: '1.5px solid #6a655c',
  borderRadius: 'var(--r)',
  minWidth: 200,
};

const micLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: '1 1 220px',
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#b6b1a5',
};

const micCapStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  color: '#b6b1a5',
};

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

  // Status readout mirrors the design's "● SIGNAL GOOD" / advisory states.
  const status =
    permission === 'denied'
      ? { dot: 'var(--flux)', text: 'NO SIGNAL' }
      : permission === 'granted'
        ? { dot: 'var(--flux)', text: 'SIGNAL GOOD' }
        : { dot: '#6a655c', text: 'CHECKING…' };

  return (
    <section className="device-picker" aria-label="Microphone input" style={micCardStyle}>
      <div style={micHeadStyle}>
        <span>Mic check</span>
        <span style={{ color: status.dot, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: status.dot,
              display: 'inline-block',
            }}
          />
          {status.text}
        </span>
      </div>

      <div style={micRowStyle}>
        <label style={micLabelStyle}>
          Audio input
          <select
            disabled={disabled}
            value={deviceId ?? ''}
            onChange={(e) => handleSelect(e.target.value)}
            style={micSelectStyle}
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
          type="button"
          className="btn btn-small"
          onClick={() => void refresh()}
          disabled={disabled}
          title="Re-scan input devices"
          style={{
            color: 'var(--paper)',
            borderColor: '#6a655c',
            background: 'transparent',
          }}
        >
          Rescan
        </button>
      </div>

      {permission === 'denied' ? (
        <span className="device-warn" style={{ color: 'var(--flux)' }}>
          Mic permission denied — pitch detection will not work.
        </span>
      ) : (
        <span style={micCapStyle}>
          Play your low E — we should see the needle jump.
        </span>
      )}
    </section>
  );
}
