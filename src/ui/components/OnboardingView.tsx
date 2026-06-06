// OnboardingView — the first-run setup hero (design/app.html screen 01).
//
// Disposable UI layer (brief sections 2 & 5). The encouraging first paint the
// design opens on: a kicker, the "Let's get you reading." headline, the .sub
// copy + headphone tip, the MIC CHECK hero (the promoted DevicePicker), three
// .scard setup cards (Key / Position / Tempo, the app's real line config) and a
// "Start practicing →" CTA with a skip line. Cards rise in with the staggered
// .reveal motion.
//
// PRESENTATION ONLY: this gates on the persisted `onboardingComplete` flag (read
// in App.tsx) and, on Start/skip, hands the chosen UiConfig back so practice
// generates the first line from it. No behaviour beyond config selection + the
// flag write — the same UiConfig contract the ConfigPanel already uses.

import React from 'react';
import {
  KEY_CHOICES,
  POSITION_CHOICES,
  type UiConfig,
} from '../lineConfig.js';
import { DevicePicker } from './DevicePicker.js';

export interface OnboardingViewProps {
  config: UiConfig;
  onChange: (next: UiConfig) => void;
  /** The MIC CHECK hero is the live DevicePicker; App owns the device id. */
  inputDeviceId: string | undefined;
  onDeviceChange: (deviceId: string | undefined) => void;
  /** Start practicing / skip — both finish onboarding (App persists the flag). */
  onStart: () => void;
}

/** A small tempo menu rendered as segmented options (design .seg .opt). The
 *  middle option carries the flux highlight, echoing the design's "5 min" pill. */
const TEMPO_CHOICES: ReadonlyArray<{ label: string; tempo: number; flux?: boolean }> = [
  { label: '80 bpm', tempo: 80 },
  { label: '96 bpm', tempo: 96, flux: true },
  { label: '120 bpm', tempo: 120 },
];

export function OnboardingView({
  config,
  onChange,
  inputDeviceId,
  onDeviceChange,
  onStart,
}: OnboardingViewProps): React.JSX.Element {
  return (
    <div className="onboarding">
      <div className="onb">
        <div className="hello">
          <div className="reveal d1">
            <p className="kicker">
              <span className="reg" style={{ color: 'var(--blue)' }}>
                ✛
              </span>{' '}
              Welcome · setup 1 of 1
            </p>
            <h2>Let&rsquo;s get you reading.</h2>
            <p className="sub">
              Five minutes a day is enough. We&rsquo;ll generate the music and
              listen to your guitar — you just play. Quick check before your first
              line:
            </p>
            <div className="tip">
              <span className="em" aria-hidden="true">
                🎧
              </span>{' '}
              Use headphones so the metronome doesn&rsquo;t leak into the mic. It
              keeps your scores honest.
            </div>
          </div>

          {/* MIC CHECK hero — the DevicePicker promoted out of the dev-tools
              drawer (it already carries the dark .mic console treatment). */}
          <div className="mic-slot reveal d2">
            <DevicePicker
              deviceId={inputDeviceId}
              disabled={false}
              onChange={onDeviceChange}
            />
          </div>
        </div>

        <div className="setup">
          <div className="scard reveal d3">
            <div className="no">A · Key</div>
            <h3>Where to start?</h3>
            <div className="seg">
              {KEY_CHOICES.map((k, i) => (
                <button
                  key={k.label}
                  type="button"
                  className={'opt' + (config.keyIndex === i ? ' on' : '')}
                  aria-pressed={config.keyIndex === i}
                  onClick={() => onChange({ ...config, keyIndex: i })}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="scard reveal d4">
            <div className="no">B · Position</div>
            <h3>Fretboard position</h3>
            <div className="seg">
              {POSITION_CHOICES.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  className={'opt' + (config.positionIndex === i ? ' on' : '')}
                  aria-pressed={config.positionIndex === i}
                  onClick={() => onChange({ ...config, positionIndex: i })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="scard reveal d5">
            <div className="no">C · Tempo</div>
            <h3>How fast a day?</h3>
            <div className="seg">
              {TEMPO_CHOICES.map((t) => {
                const on = config.tempo === t.tempo;
                return (
                  <button
                    key={t.label}
                    type="button"
                    className={'opt' + (on ? ' on' : t.flux ? ' flux' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ ...config, tempo: t.tempo })}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="go reveal d6">
          <button type="button" className="btn-play" onClick={onStart}>
            Start practicing →
          </button>
          <span className="skip">You can change all of this anytime.</span>
        </div>
      </div>
    </div>
  );
}
