// ConfigPanel — the line-setup console, restyled to the "Signal Tape" system.
//
// Disposable UI layer (brief section 2). Lets the human pick key / position /
// bar count / tempo before generating the next line. Changes take effect on the
// NEXT "Next line" press (we don't regenerate mid-run).
//
// PRESENTATION ONLY: this renders the Signal Tape segmented/console controls from
// design/app.html screen 01 (the .scard "setup" cards + .seg segmented options).
// Behaviour is unchanged — the exact UiConfig onChange contract is preserved:
//   key/position write keyIndex/positionIndex; bars/tempo write barCount/tempo.
// No styles.css edits: the look is built from the global Signal Tape design tokens
// (var(--ink), var(--paper*), var(--blue), var(--flux), var(--mono)) via inline
// styles, which are permitted by the renderer CSP (style-src 'self' 'unsafe-inline').

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

// ---- Signal Tape inline-style fragments (design .scard / .seg / .opt) ----------

const cardStyle: React.CSSProperties = {
  border: '1.5px solid var(--ink)',
  background: 'var(--paper-2)',
  borderRadius: 'var(--r)',
  padding: '14px 16px',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cardNoStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--blue)',
};

const cardTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--disp)',
  fontWeight: 900,
  fontSize: 16,
  letterSpacing: '-0.02em',
  lineHeight: 1,
  margin: 0,
};

const segRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const stepperStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--mono)',
};

const stepperReadoutStyle: React.CSSProperties = {
  fontFamily: 'var(--disp)',
  fontWeight: 900,
  fontSize: 26,
  letterSpacing: '-0.03em',
  lineHeight: 1,
  minWidth: 48,
  textAlign: 'center',
};

const stepperUnitStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

/** A single segmented option (design .seg .opt). `tone` flux highlights the
 *  selected option in the live-feedback colour; otherwise selection is the ink fill. */
function SegOption({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const style: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    border: '1.5px solid var(--ink)',
    borderRadius: 'var(--r)',
    padding: '6px 10px',
    cursor: disabled ? 'default' : 'pointer',
    background: selected ? 'var(--ink)' : 'var(--paper)',
    color: selected ? 'var(--paper)' : 'var(--ink)',
    opacity: disabled ? 0.45 : 1,
    transition: 'background 0.12s ease, color 0.12s ease, transform 0.12s ease',
    whiteSpace: 'nowrap',
  };
  return (
    <button
      type="button"
      className="seg-opt"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      style={style}
    >
      {label}
    </button>
  );
}

/** A console stepper for a clamped integer (design .scard numeric console). */
function Stepper({
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (next: number) => void;
  ariaLabel: string;
}): React.JSX.Element {
  const btn = (delta: number, glyph: string): React.JSX.Element => {
    const next = clampInt(value + delta, min, max, value);
    const atLimit = next === value;
    return (
      <button
        type="button"
        className="btn btn-small"
        disabled={disabled || atLimit}
        aria-label={`${glyph === '−' ? 'Decrease' : 'Increase'} ${ariaLabel}`}
        onClick={() => onChange(next)}
        style={{ minWidth: 36, padding: '8px 0', textAlign: 'center' }}
      >
        {glyph}
      </button>
    );
  };
  return (
    <div style={stepperStyle}>
      {btn(-step, '−')}
      <span style={stepperReadoutStyle} aria-live="polite">
        {value}
      </span>
      {btn(step, '+')}
      <span style={stepperUnitStyle}>{unit}</span>
    </div>
  );
}

export function ConfigPanel({
  config,
  disabled,
  onChange,
}: ConfigPanelProps): React.JSX.Element {
  return (
    <section
      className="config-panel"
      aria-label="Line setup"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        alignItems: 'stretch',
        background: 'transparent',
        border: 0,
        padding: 0,
      }}
    >
      <div className="scard" style={cardStyle}>
        <span style={cardNoStyle}>A · Key</span>
        <h3 style={cardTitleStyle}>Where to start?</h3>
        <div style={segRowStyle}>
          {KEY_CHOICES.map((k, i) => (
            <SegOption
              key={k.label}
              label={k.label}
              selected={config.keyIndex === i}
              disabled={disabled}
              onSelect={() => onChange({ ...config, keyIndex: i })}
            />
          ))}
        </div>
      </div>

      <div className="scard" style={cardStyle}>
        <span style={cardNoStyle}>B · Position</span>
        <h3 style={cardTitleStyle}>Fretboard position</h3>
        <div style={segRowStyle}>
          {POSITION_CHOICES.map((p, i) => (
            <SegOption
              key={p.label}
              label={p.label}
              selected={config.positionIndex === i}
              disabled={disabled}
              onSelect={() => onChange({ ...config, positionIndex: i })}
            />
          ))}
        </div>
      </div>

      <div className="scard" style={cardStyle}>
        <span style={cardNoStyle}>C · Length</span>
        <h3 style={cardTitleStyle}>How many bars?</h3>
        <Stepper
          value={config.barCount}
          min={2}
          max={16}
          step={1}
          unit="bars"
          disabled={disabled}
          ariaLabel="bar count"
          onChange={(barCount) => onChange({ ...config, barCount })}
        />
      </div>

      <div className="scard" style={cardStyle}>
        <span style={cardNoStyle}>D · Tempo</span>
        <h3 style={cardTitleStyle}>How fast?</h3>
        <Stepper
          value={config.tempo}
          min={30}
          max={300}
          step={5}
          unit="bpm"
          disabled={disabled}
          ariaLabel="tempo"
          onChange={(tempo) => onChange({ ...config, tempo })}
        />
      </div>
    </section>
  );
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
