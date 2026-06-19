// SettingsView.tsx — the Settings tab (third top-level view next to Practice /
// Stats), styled to the "Signal Tape" system.
//
// Disposable UI layer. Gathers the controls the user reaches for between takes:
//   01 · Audio      — input device picker + live needle + pitch-detector choice.
//   02 · Practice   — key / position / bars / tempo (the SAME persisted, last-used
//                     config the practice ConfigPanel edits) + re-show headphone tip.
//   03 · Developer  — Chromium DevTools (inspector) toggle + the in-app dev-drawer
//                     switch (both persisted / live where applicable).
//
// State lives in App (single source of truth); this view is controlled entirely by
// props + callbacks, mirroring how ConfigPanel / DevicePicker are already wired.
// No styles.css edits: the look is built from the shared Signal Tape design tokens
// (var(--ink), var(--paper*), var(--blue), var(--flux), var(--mono), var(--disp))
// via inline styles, permitted by the renderer CSP (style-src 'self' 'unsafe-inline').

import React, { useCallback, useEffect, useState } from 'react';
import { ConfigPanel } from '../components/ConfigPanel.js';
import { DevicePicker } from '../components/DevicePicker.js';
import { useLiveInputLevel } from '../useLiveInputLevel.js';
import type { UiConfig } from '../lineConfig.js';
import type { DetectorKind } from '../../audio/index.js';

export interface SettingsViewProps {
  config: UiConfig;
  onConfigChange: (next: UiConfig) => void;
  inputDeviceId: string | undefined;
  onDeviceChange: (deviceId: string | undefined) => void;
  detectorKind: DetectorKind;
  onDetectorChange: (kind: DetectorKind) => void;
  /** Whether the practice tab's in-app dev drawer is shown (persisted). */
  devDrawerVisible: boolean;
  onDevDrawerToggle: (next: boolean) => void;
  /** Re-show the one-time headphone tip (App un-dismisses + persists). */
  onResetHeadphoneTip: () => void;
  /** A take is running — disable edits that fight the live audio graph. */
  isRunning: boolean;
  /** This view is the active tab — gates the live input monitor so we don't tap
   *  the mic at the same time as the practice view. */
  active: boolean;
}

// ---- Signal Tape inline-style fragments ------------------------------------

const panelStyle: React.CSSProperties = {
  border: '1.5px solid var(--ink)',
  background: 'var(--paper-2)',
  borderRadius: 'var(--r)',
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const kickerStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--blue)',
};

const panelTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--disp)',
  fontWeight: 900,
  fontSize: 20,
  letterSpacing: '-0.02em',
  lineHeight: 1,
  margin: 0,
};

const hintStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  color: 'var(--ink-3)',
  margin: 0,
  lineHeight: 1.4,
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const selectStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 13,
  padding: '8px 9px',
  background: 'var(--paper)',
  color: 'var(--ink)',
  border: '1.5px solid var(--ink)',
  borderRadius: 'var(--r)',
  alignSelf: 'flex-start',
  minWidth: 240,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
};

const rowHeadStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const fieldCapStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.04em',
  color: 'var(--ink)',
};

const electronOnlyStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

/** A segmented on/off toggle (design .seg .opt). Flux fill marks the live/ON
 *  state, echoing the app's "flux = live/feedback" colour language. */
function Toggle({
  on,
  disabled,
  labelOn,
  labelOff,
  onClick,
  ariaLabel,
}: {
  on: boolean;
  disabled?: boolean;
  labelOn: string;
  labelOff: string;
  onClick: () => void;
  ariaLabel: string;
}): React.JSX.Element {
  const style: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    border: '1.5px solid var(--ink)',
    borderRadius: 'var(--r)',
    padding: '7px 16px',
    cursor: disabled ? 'default' : 'pointer',
    background: on ? 'var(--flux)' : 'var(--paper)',
    color: on ? '#fff' : 'var(--ink)',
    opacity: disabled ? 0.45 : 1,
    minWidth: 96,
    transition: 'background 0.12s ease, color 0.12s ease',
  };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      style={style}
    >
      {on ? labelOn : labelOff}
    </button>
  );
}

export function SettingsView({
  config,
  onConfigChange,
  inputDeviceId,
  onDeviceChange,
  detectorKind,
  onDetectorChange,
  devDrawerVisible,
  onDevDrawerToggle,
  onResetHeadphoneTip,
  isRunning,
  active,
}: SettingsViewProps): React.JSX.Element {
  // One live mic tap while this tab is showing and no take is running — the
  // practice view's monitor is gated off whenever view !== 'practice', so the two
  // never tap the device at once.
  const level = useLiveInputLevel(inputDeviceId, active && !isRunning);

  // Chromium DevTools (inspector) toggle state — seeded from main on mount and
  // kept in sync via the 'devtools:changed' push (e.g. closed via the inspector
  // itself). Absent outside Electron, where we show an "Electron only" note.
  const devtools =
    typeof window !== 'undefined' ? window.sightReading?.devtools : undefined;
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  useEffect(() => {
    if (!devtools) return;
    let cancelled = false;
    void devtools.isOpen().then((open) => {
      if (!cancelled) setDevtoolsOpen(open);
    });
    const unsubscribe = devtools.onChange((open) => setDevtoolsOpen(open));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [devtools]);

  const toggleDevtools = useCallback((): void => {
    if (!devtools) return;
    void devtools.toggle().then((r) => setDevtoolsOpen(r.open));
  }, [devtools]);

  return (
    <section
      className="settings-view"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <header className="stats-header">
        <h2>Settings.</h2>
        <p className="subtitle">Audio, practice defaults, and developer tools.</p>
      </header>

      {/* 01 · PRACTICE ------------------------------------------------------- */}
      <div style={panelStyle}>
        <span style={kickerStyle}>01 · Practice</span>
        <h3 style={panelTitleStyle}>Default line</h3>
        <p style={hintStyle}>
          Remembered as your last-used settings — practice opens here next time,
          and changes you make in the practice console land here too.
        </p>
        <ConfigPanel config={config} disabled={isRunning} onChange={onConfigChange} />
        <div style={rowStyle}>
          <div style={rowHeadStyle}>
            <span style={fieldCapStyle}>Headphone tip</span>
            <span style={hintStyle}>Bring back the one-time headphone guidance.</span>
          </div>
          <button type="button" className="btn btn-small" onClick={onResetHeadphoneTip}>
            Re-show headphone tip
          </button>
        </div>
      </div>

      {/* 02 · AUDIO ---------------------------------------------------------- */}
      <div style={panelStyle}>
        <span style={kickerStyle}>02 · Audio</span>
        <h3 style={panelTitleStyle}>Input &amp; detection</h3>
        <DevicePicker
          deviceId={inputDeviceId}
          disabled={isRunning}
          onChange={onDeviceChange}
          level={level}
        />
        <label style={fieldLabelStyle}>
          Pitch detector
          <select
            value={detectorKind}
            disabled={isRunning}
            onChange={(e) => onDetectorChange(e.target.value as DetectorKind)}
            style={selectStyle}
          >
            <option value="pitchy">pitchy — fast, default</option>
            <option value="crepe">CREPE — octave-robust (TensorFlow.js)</option>
          </select>
        </label>
        <p style={hintStyle}>
          Confirm your interface is picking up signal — play your low E and watch
          the needle jump. CREPE falls back to pitchy if its model fails to load.
        </p>
      </div>

      {/* 03 · DEVELOPER ------------------------------------------------------ */}
      <div style={panelStyle}>
        <span style={kickerStyle}>03 · Developer</span>
        <h3 style={panelTitleStyle}>Tools</h3>
        <div style={rowStyle}>
          <div style={rowHeadStyle}>
            <span style={fieldCapStyle}>Chromium DevTools</span>
            <span style={hintStyle}>Open the inspector for the renderer.</span>
          </div>
          {devtools ? (
            <Toggle
              on={devtoolsOpen}
              labelOn="Open"
              labelOff="Closed"
              ariaLabel="Toggle Chromium DevTools inspector"
              onClick={toggleDevtools}
            />
          ) : (
            <span style={electronOnlyStyle}>Electron only</span>
          )}
        </div>
        <div style={rowStyle}>
          <div style={rowHeadStyle}>
            <span style={fieldCapStyle}>In-app dev drawer</span>
            <span style={hintStyle}>
              Synthetic-take harness &amp; detector picker in Practice.
            </span>
          </div>
          <Toggle
            on={devDrawerVisible}
            labelOn="Shown"
            labelOff="Hidden"
            ariaLabel="Toggle the in-app dev-tools drawer"
            onClick={() => onDevDrawerToggle(!devDrawerVisible)}
          />
        </div>
      </div>
    </section>
  );
}
