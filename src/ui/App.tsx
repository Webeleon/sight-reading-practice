// Root React component — Milestone 3 read-along shell.
//
// Disposable UI layer (brief sections 2 & 5): React/DOM/Web-Audio allowed.
//
// Wires together (brief section 13 + Milestone 3 acceptance criteria):
//   * OsmdView           — renders the current generated Line as notation.
//   * useReadAlong       — the metronome-driven, musical-time cursor loop.
//   * ConfigPanel        — key / position / bars / tempo (functional, not polished).
//   * TimingReadout      — live phase + the Gate-2 ±20ms deviation evidence.
//   * Transport          — Start (count-in then play) and Next line (fresh seed).
//
// Keyboard: Enter / Space => Next line (and, when idle, Start). The metronome clock
// is authoritative and never waits for the user (brief section 12).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '../domain/index.js';
import { OsmdView, type CursorHandle } from './components/OsmdView.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { TimingReadout } from './components/TimingReadout.js';
import { useReadAlong } from './useReadAlong.js';
import {
  DEFAULT_UI_CONFIG,
  generateFreshLine,
  type UiConfig,
} from './lineConfig.js';

interface SightReadingBridge {
  isElectron: boolean;
  versions: { electron: string; chrome: string; node: string };
}
declare global {
  interface Window {
    sightReading?: SightReadingBridge;
  }
}

export function App(): React.JSX.Element {
  const bridge = typeof window !== 'undefined' ? window.sightReading : undefined;

  const [uiConfig, setUiConfig] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [line, setLine] = useState<Line | null>(null);
  const cursorHandleRef = useRef<CursorHandle | null>(null);
  // A nonce so useReadAlong rebinds its callbacks when the cursor handle is (re)attached.
  const [cursorReady, setCursorReady] = useState(false);

  const { readout, start, stop, isRunning } = useReadAlong({
    line,
    cursor: cursorReady ? cursorHandleRef.current : null,
    countInBars: 2,
  });

  // Generate the first line on mount.
  useEffect(() => {
    setLine(generateFreshLine(DEFAULT_UI_CONFIG));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNextLine = useCallback((): void => {
    stop();
    const next = generateFreshLine(uiConfig);
    setLine(next);
  }, [uiConfig, stop]);

  const handleStart = useCallback((): void => {
    if (!line) return;
    start();
  }, [line, start]);

  // Keyboard transport: Enter => Next line, Space => Start (if not running).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ignore when typing in the config inputs.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNextLine();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!isRunning) handleStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNextLine, handleStart, isRunning]);

  return (
    <main className="app-shell read-along">
      <header className="app-header">
        <div>
          <h1>Sight Reading</h1>
          <p className="subtitle">Milestone 3 — read-along (metronome-driven cursor)</p>
        </div>
        <p className="env-line">
          {bridge?.isElectron
            ? `Electron ${bridge.versions.electron} · Chromium ${bridge.versions.chrome}`
            : 'Browser preview (outside Electron)'}
        </p>
      </header>

      <section className="transport">
        <button
          className="btn btn-primary"
          onClick={handleNextLine}
          title="Generate a fresh line (Enter)"
        >
          Next line ⏎
        </button>
        <button
          className="btn"
          onClick={handleStart}
          disabled={isRunning || !line}
          title="Count-in then play (Space)"
        >
          {isRunning ? 'Playing…' : 'Start ␣'}
        </button>
        <button className="btn" onClick={stop} disabled={!isRunning}>
          Stop
        </button>
      </section>

      <ConfigPanel
        config={uiConfig}
        disabled={isRunning}
        onChange={setUiConfig}
      />

      <section className="staff-area">
        <OsmdView
          line={line}
          ref={(h) => {
            cursorHandleRef.current = h;
            setCursorReady(h !== null);
          }}
          onRendered={(l) => console.log(`[UI] line rendered: ${l.id}`)}
        />
      </section>

      <TimingReadout readout={readout} tempo={line?.tempo ?? uiConfig.tempo} />
    </main>
  );
}
