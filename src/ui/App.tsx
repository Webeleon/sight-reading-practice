// Root React component — Milestone 4 read-AND-evaluate shell.
//
// Disposable UI layer (brief sections 2 & 5): React/DOM/Web-Audio allowed.
//
// Wires together (brief sections 12 & 13 + Milestone 4 acceptance criteria):
//   * OsmdView          — renders the Line and recolours noteheads for feedback.
//   * useSightReading   — metronome cursor + live pitch detection + evaluation +
//                         real-time trailing colour + the final result.
//   * DevicePicker      — choose + persist the audio input device.
//   * HeadphoneTip      — one-time, non-blocking headphone guidance.
//   * ConfigPanel       — key / position / bars / tempo.
//   * ResultsScreen     — pitch/timing accuracy + the three actions (Next /
//                         Retry at tempo / Retry slower) with attempt_type.
//   * Synthetic harness — run the evaluation/feedback/results path WITHOUT a
//                         guitar (a tunable synthetic take), so Gate-3 hardware is
//                         not needed to exercise the pipeline.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '../domain/index.js';
import { OsmdView, type CursorHandle } from './components/OsmdView.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { DevicePicker } from './components/DevicePicker.js';
import { HeadphoneTip } from './components/HeadphoneTip.js';
import { ResultsScreen } from './components/ResultsScreen.js';
import {
  useSightReading,
  type AttemptType,
} from './useSightReading.js';
import {
  synthesizeTake,
  synthesizePerfectTake,
  synthesizeKnownErrorTake,
} from './evaluationBridge.js';
import type { DetectedNote } from '../evaluation/index.js';
import {
  DEFAULT_UI_CONFIG,
  generateFreshLine,
  type UiConfig,
} from './lineConfig.js';
// appConfig.ts owns the global `Window.sightReading` declaration (it adds the
// `config` IPC member); importing it keeps a single source of truth for the type.
import './appConfig.js';

const COUNT_IN_BARS = 2;
const RETRY_SLOWER_FACTOR = 0.7; // retry_slower tempo = 70% of configured tempo

export function App(): React.JSX.Element {
  const bridge = typeof window !== 'undefined' ? window.sightReading : undefined;

  const [uiConfig, setUiConfig] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [line, setLine] = useState<Line | null>(null);
  const [inputDeviceId, setInputDeviceId] = useState<string | undefined>(undefined);
  // Synthetic-take harness (hardware-free testing of the evaluation/feedback path).
  const [syntheticMode, setSyntheticMode] = useState(false);
  const [syntheticAccuracy, setSyntheticAccuracy] = useState(0.8);
  // "Hear line": optionally play a soft tone per note alongside the clicks (ON by
  // default — the human asked to hear the line while reading).
  const [melody, setMelody] = useState(true);

  const cursorHandleRef = useRef<CursorHandle | null>(null);
  const [cursorReady, setCursorReady] = useState(false);

  const {
    phase,
    isRunning,
    result,
    attemptType,
    detectedCount,
    countInBeat,
    countInTotalBeats,
    start,
    stop,
  } = useSightReading({
    line,
    cursor: cursorReady ? cursorHandleRef.current : null,
    countInBars: COUNT_IN_BARS,
    inputDeviceId,
    melody,
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
    cursorHandleRef.current?.clearColors();
  }, [uiConfig, stop]);

  // Build the synthetic take (if enabled) for `runLine`, then start the run. The
  // line + take are passed explicitly to start() so there is no re-render race
  // (e.g. Retry-slower runs its modified-tempo line immediately). An explicit
  // `forcedTake` (from the two named synthetic buttons) overrides the slider.
  const beginRun = useCallback(
    (
      type: AttemptType,
      runLine: Line,
      forcedTake?: DetectedNote[] | null,
    ): void => {
      let take: DetectedNote[] | null = null;
      if (forcedTake !== undefined) {
        take = forcedTake; // explicit named synthetic take (perfect / known errors)
      } else if (syntheticMode) {
        take = synthesizeTake(runLine, COUNT_IN_BARS, {
          accuracy: syntheticAccuracy,
          timingJitterMs: 25,
        });
      }
      start(type, { line: runLine, syntheticTake: take });
    },
    [syntheticMode, syntheticAccuracy, start],
  );

  // The two explicit synthetic-take buttons the brief names (hardware-free
  // Gate-3 preview). Both run the CURRENT line as a `first_read` through the
  // SAME real-time-feedback + results path the mic would drive, so the colours
  // animate with the cursor and the results screen shows the resulting metrics.
  const handleSimulatePerfect = useCallback((): void => {
    if (!line) return;
    cursorHandleRef.current?.clearColors();
    console.log('[UI] synthetic harness: SIMULATE PERFECT TAKE');
    beginRun('first_read', line, synthesizePerfectTake(line, COUNT_IN_BARS));
  }, [line, beginRun]);

  const handleSimulateErrors = useCallback((): void => {
    if (!line) return;
    cursorHandleRef.current?.clearColors();
    console.log(
      '[UI] synthetic harness: SIMULATE TAKE WITH ERRORS ' +
        '(2 wrong-pitch, 1 late, 1 missed, 1 extra)',
    );
    beginRun('first_read', line, synthesizeKnownErrorTake(line, COUNT_IN_BARS));
  }, [line, beginRun]);

  const handleStart = useCallback((): void => {
    if (!line) return;
    beginRun('first_read', line);
  }, [line, beginRun]);

  const handleRetryAtTempo = useCallback((): void => {
    if (!line) return;
    cursorHandleRef.current?.clearColors();
    beginRun('retry_at_tempo', line);
  }, [line, beginRun]);

  const handleRetrySlower = useCallback((): void => {
    if (!line) return;
    const slower: Line = {
      ...line,
      tempo: Math.max(30, Math.round(line.tempo * RETRY_SLOWER_FACTOR)),
    };
    setLine(slower); // reflect the slower tempo in the UI / results
    cursorHandleRef.current?.clearColors();
    beginRun('retry_slower', slower); // run the modified line immediately
  }, [line, beginRun]);

  // Keyboard transport: Enter => Next line, Space => Start (if idle).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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

  const showResults = phase === 'finished' && result !== null;

  return (
    <main className="app-shell read-along">
      <header className="app-header">
        <div>
          <h1>Sight Reading</h1>
          <p className="subtitle">
            Milestone 4 — pitch detection · evaluation · feedback
          </p>
        </div>
        <p className="env-line">
          {bridge?.isElectron
            ? `Electron ${bridge.versions.electron} · Chromium ${bridge.versions.chrome}`
            : 'Browser preview (outside Electron)'}
        </p>
      </header>

      <HeadphoneTip />

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
          title="Count-in then play + evaluate (Space)"
        >
          {isRunning ? 'Running…' : 'Start ␣'}
        </button>
        <button className="btn" onClick={stop} disabled={!isRunning}>
          Stop
        </button>
        <label
          className="hear-line"
          title="Play a soft tone per note alongside the clicks (synced to the same clock)"
        >
          <input
            type="checkbox"
            checked={melody}
            disabled={isRunning}
            onChange={(e) => setMelody(e.target.checked)}
          />
          Hear line
        </label>
        <span className="detected-count">detected: {detectedCount}</span>
      </section>

      <DevicePicker
        deviceId={inputDeviceId}
        disabled={isRunning}
        onChange={setInputDeviceId}
      />

      <ConfigPanel config={uiConfig} disabled={isRunning} onChange={setUiConfig} />

      <section className="synthetic-harness">
        <span className="synthetic-title" title="Drive the whole M4 path with no guitar (Gate-3 preview)">
          Synthetic take (no hardware):
        </span>
        <button
          className="btn btn-small"
          onClick={handleSimulatePerfect}
          disabled={isRunning || !line}
          title="Every expected note detected on time at the correct pitch -> all green"
        >
          Simulate perfect take
        </button>
        <button
          className="btn btn-small"
          onClick={handleSimulateErrors}
          disabled={isRunning || !line}
          title="Fixed mix: 2 wrong-pitch, 1 late, 1 missed, 1 extra -> see every colour"
        >
          Simulate take with errors
        </button>
        <label
          className="synthetic-random"
          title="Use the Start button with this random-accuracy take instead of the mic"
        >
          <input
            type="checkbox"
            checked={syntheticMode}
            disabled={isRunning}
            onChange={(e) => setSyntheticMode(e.target.checked)}
          />
          random take on Start
        </label>
        {syntheticMode && (
          <label>
            accuracy {Math.round(syntheticAccuracy * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={syntheticAccuracy}
              disabled={isRunning}
              onChange={(e) => setSyntheticAccuracy(Number(e.target.value))}
            />
          </label>
        )}
      </section>

      <section className="staff-area">
        <OsmdView
          line={line}
          ref={(h) => {
            cursorHandleRef.current = h;
            setCursorReady(h !== null);
          }}
          onRendered={(l) => console.log(`[UI] line rendered: ${l.id}`)}
        />
        {phase === 'countIn' && countInTotalBeats > 0 && (
          <div className="countin-overlay" role="status" aria-live="polite">
            <div className="countin-label">Count-in</div>
            <div className="countin-number" key={countInBeat}>
              {countInBeat}
            </div>
            <div className="countin-dots">
              {Array.from({ length: countInTotalBeats }, (_, i) => (
                <span
                  key={i}
                  className={
                    'countin-dot' + (i + 1 === countInBeat ? ' is-current' : '')
                  }
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="phase-line">
        Phase: <strong>{phase}</strong>
        {line ? ` · ${line.tempo} BPM · ${line.notes.length} notes` : ''}
      </section>

      {showResults && line && result && (
        <ResultsScreen
          line={line}
          result={result}
          attemptType={attemptType}
          onNextLine={handleNextLine}
          onRetryAtTempo={handleRetryAtTempo}
          onRetrySlower={handleRetrySlower}
        />
      )}
    </main>
  );
}
