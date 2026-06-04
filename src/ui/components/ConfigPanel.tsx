// ConfigPanel — functional (not polished) controls for the line config.
//
// Disposable UI layer (brief section 2: functional/ugly is correct). Lets the human
// pick key / position / bar count / tempo before generating the next line. Changes
// take effect on the NEXT "Next line" press (we don't regenerate mid-run).

import React from 'react';
import {
  KEY_CHOICES,
  POSITION_CHOICES,
  type UiConfig,
} from '../lineConfig.js';

export interface ConfigPanelProps {
  config: UiConfig;
  disabled: boolean;
  onChange: (next: UiConfig) => void;
}

export function ConfigPanel({
  config,
  disabled,
  onChange,
}: ConfigPanelProps): React.JSX.Element {
  return (
    <div className="config-panel">
      <label>
        Key
        <select
          disabled={disabled}
          value={config.keyIndex}
          onChange={(e) =>
            onChange({ ...config, keyIndex: Number(e.target.value) })
          }
        >
          {KEY_CHOICES.map((k, i) => (
            <option key={k.label} value={i}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Position
        <select
          disabled={disabled}
          value={config.positionIndex}
          onChange={(e) =>
            onChange({ ...config, positionIndex: Number(e.target.value) })
          }
        >
          {POSITION_CHOICES.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Bars
        <input
          type="number"
          min={2}
          max={16}
          disabled={disabled}
          value={config.barCount}
          onChange={(e) =>
            onChange({
              ...config,
              barCount: clampInt(Number(e.target.value), 2, 16, 4),
            })
          }
        />
      </label>

      <label>
        Tempo (BPM)
        <input
          type="number"
          min={30}
          max={300}
          disabled={disabled}
          value={config.tempo}
          onChange={(e) =>
            onChange({
              ...config,
              tempo: clampInt(Number(e.target.value), 30, 300, 120),
            })
          }
        />
      </label>
    </div>
  );
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
