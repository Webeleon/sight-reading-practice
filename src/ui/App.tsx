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
//
// PRESENTATION: this file is restyled to the "Signal Tape" direction (design/
// app.html screen 02 + the app-window chrome). The behaviour is UNCHANGED — every
// prop, hook, ref, callback, effect and keyboard handler is preserved; only the
// markup/classNames are reorganised into the design's app-window → topbar → sheet
// → console → status-bar hierarchy. The structural chrome the global stylesheet
// (styles.css) does not already own is provided by a scoped <style> below (CSP
// allows style-src 'unsafe-inline'); the fonts + palette + the styled component
// classes all come from styles.css.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '../domain/index.js';
import { OsmdView, type CursorHandle } from './components/OsmdView.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { DevicePicker } from './components/DevicePicker.js';
import { HeadphoneTip } from './components/HeadphoneTip.js';
import { OnboardingView } from './components/OnboardingView.js';
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
import type { DetectedNote, EvaluationResult } from '../evaluation/index.js';
import { DEFAULT_DETECTOR_KIND, type DetectorKind } from '../audio/index.js';
import { getAppConfig, setAppConfig } from './appConfig.js';
import {
  DEFAULT_UI_CONFIG,
  generateFreshLine,
  toLineConfig,
  KEY_CHOICES,
  POSITION_CHOICES,
  type UiConfig,
} from './lineConfig.js';
import { StatsView } from './views/StatsView.js';
import {
  startSession,
  endSession,
  writeCompletedAttempt,
  persistenceAvailable,
  newId,
} from './sessionBridge.js';
// appConfig.ts owns the global `Window.sightReading` declaration (it adds the
// `config` IPC member) AND the detector-choice persistence used below; the named
// import above keeps a single source of truth for that type.

const COUNT_IN_BARS = 1;
const RETRY_SLOWER_FACTOR = 0.7; // retry_slower tempo = 70% of configured tempo

/** Which top-level screen is showing (brief M5: switch practice <-> stats). */
type AppView = 'practice' | 'stats';

/** Short, uppercase attempt-type label for the topbar / status chips. */
function attemptLabel(type: AttemptType): string {
  switch (type) {
    case 'first_read':
      return 'FIRST READ';
    case 'retry_at_tempo':
      return 'RETRY';
    case 'retry_slower':
      return 'RETRY · SLOWER';
  }
}

export function App(): React.JSX.Element {
  const bridge = typeof window !== 'undefined' ? window.sightReading : undefined;

  const [view, setView] = useState<AppView>('practice');
  // First-run onboarding gate (design screen 01). `null` = still resolving the
  // persisted `onboardingComplete` flag; `false` = show the setup hero; `true` =
  // mount the practice/stats app. Resolved once on mount via getAppConfig.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [uiConfig, setUiConfig] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [line, setLine] = useState<Line | null>(null);
  const [inputDeviceId, setInputDeviceId] = useState<string | undefined>(undefined);
  // Which pitch detector to run for LIVE takes. pitchy is the DEFAULT + always-
  // available fallback; CREPE is opt-in (TensorFlow.js, octave-robust). Persisted
  // via the appConfig IPC so the A/B choice survives a relaunch. The detection-
  // review header shows the detector that ACTUALLY ran (after any CREPE fallback).
  const [detectorKind, setDetectorKind] = useState<DetectorKind>(DEFAULT_DETECTOR_KIND);
  // Synthetic-take harness (hardware-free testing of the evaluation/feedback path).
  const [syntheticMode, setSyntheticMode] = useState(false);
  const [syntheticAccuracy, setSyntheticAccuracy] = useState(0.8);
  // "Hear line": optionally play a soft tone per note alongside the clicks (ON by
  // default — the human asked to hear the line while reading).
  const [melody, setMelody] = useState(true);
  // Dev tools drawer (synthetic-take harness + detector picker live here, kept
  // reachable but visually de-emphasised + collapsed by default).
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  const cursorHandleRef = useRef<CursorHandle | null>(null);
  const [cursorReady, setCursorReady] = useState(false);

  // --- Session-loop persistence (Milestone 5) ------------------------------
  // One sessions row per app run: started on mount, ended on unmount / quit. Each
  // COMPLETED attempt writes one line_attempts row + its note_events via IPC. The
  // renderer never touches the SQLite driver — sessionBridge.ts round-trips to the
  // main-process DB and is a graceful no-op outside Electron (browser preview).
  const sessionIdRef = useRef<string | null>(null);
  // Monotonic line_index_in_session, bumped per persisted attempt.
  const lineIndexRef = useRef(0);
  // epoch-ms when the in-flight run's musical time began (set at beginRun); paired
  // with completedAt at persist time to compute duration_ms.
  const runStartedAtRef = useRef(0);
  // The exact Line the in-flight run is reading (retry_slower runs a tempo-shifted
  // copy), captured at beginRun so persistence stores the line that was actually
  // played rather than whatever `line` state happens to be at finalize.
  const runLineRef = useRef<Line | null>(null);
  // The result object already persisted, so the finalize-watching effect writes
  // each attempt exactly once (result is a new object per run).
  const persistedResultRef = useRef<EvaluationResult | null>(null);
  const [persistenceOn] = useState<boolean>(() => persistenceAvailable());

  const {
    phase,
    isRunning,
    result,
    review,
    attemptType,
    activeDetector,
    detectedCount,
    inputLevel,
    countInBeat,
    countInTotalBeats,
    start,
    stop,
  } = useSightReading({
    line,
    cursor: cursorReady ? cursorHandleRef.current : null,
    countInBars: COUNT_IN_BARS,
    inputDeviceId,
    detectorKind,
    melody,
  });

  // Generate the first line on mount.
  useEffect(() => {
    setLine(generateFreshLine(DEFAULT_UI_CONFIG));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the persisted detector choice on mount (Electron IPC, else
  // localStorage). Defaults to pitchy if unset / persistence off.
  useEffect(() => {
    void getAppConfig().then((cfg) => {
      if (cfg.detector === 'crepe' || cfg.detector === 'pitchy') {
        setDetectorKind(cfg.detector);
        console.log(`[UI] restored detector choice: ${cfg.detector}`);
      }
    });
  }, []);

  // Resolve the first-run onboarding gate on mount: if the user has already
  // completed setup we go straight to practice; otherwise we open on the design
  // screen-01 hero. Defaults to "show onboarding" when the flag is unset.
  useEffect(() => {
    void getAppConfig().then((cfg) => {
      setOnboarded(cfg.onboardingComplete === true);
      console.log(`[UI] onboarding complete=${cfg.onboardingComplete === true}`);
    });
  }, []);

  // Finish onboarding: persist the flag, regenerate the first line from the just-
  // chosen config, and reveal the practice app. Used by both "Start practicing"
  // and the skip affordance (skip simply keeps the current/default config).
  const handleFinishOnboarding = useCallback((): void => {
    setLine(generateFreshLine(uiConfig));
    setOnboarded(true);
    void setAppConfig({ onboardingComplete: true });
    console.log('[UI] onboarding complete — entering practice');
  }, [uiConfig]);

  // Change + persist the detector choice (no-op persistence outside Electron).
  const handleDetectorChange = useCallback((kind: DetectorKind): void => {
    setDetectorKind(kind);
    console.log(`[UI] detector selected: ${kind}`);
    void setAppConfig({ detector: kind });
  }, []);

  // Begin a session on mount; end it on unmount (the main process ALSO ends any
  // still-open session on before-quit, covering a hard Cmd+Q). The configSnapshot
  // is the generator LineConfig the session started with.
  useEffect(() => {
    const id = newId();
    sessionIdRef.current = id;
    void startSession(id, toLineConfig(DEFAULT_UI_CONFIG)).then((ack) => {
      console.log(
        `[UI] session ${id} started (persisted=${ack.persisted}` +
          `${ack.persisted ? '' : ' — persistence disabled'})`,
      );
    });
    // Best-effort end on window close (renderer-driven; main has a backstop).
    const onBeforeUnload = (): void => {
      if (sessionIdRef.current) void endSession(sessionIdRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (sessionIdRef.current) {
        void endSession(sessionIdRef.current);
        sessionIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist each COMPLETED attempt exactly once. When the read-AND-evaluate hook
  // finishes a run it produces a fresh `result` object; we write one line_attempts
  // row (+ note_events) for it, keyed off the run we captured in runLineRef. Only
  // first_read counts toward fluency — but ALL three attempt_types are PERSISTED
  // (the fluency rule is enforced in the stats QUERIES, not at write time;
  // brief section 11).
  useEffect(() => {
    if (phase !== 'finished' || result === null) return;
    if (persistedResultRef.current === result) return; // already wrote this run
    const runLine = runLineRef.current;
    const sessionId = sessionIdRef.current;
    if (!runLine || !sessionId) return;
    persistedResultRef.current = result;
    const index = lineIndexRef.current++;
    void writeCompletedAttempt({
      sessionId,
      lineIndexInSession: index,
      attemptType,
      startedAt: runStartedAtRef.current,
      completedAt: Date.now(),
      line: runLine,
      result,
    }).then((ack) => {
      console.log(
        `[UI] attempt #${index} (${attemptType}) persisted=${ack.persisted} ` +
          `pitch=${(result.pitchAccuracy * 100).toFixed(0)}% ` +
          `timing=${(result.timingAccuracy * 100).toFixed(0)}% ` +
          `expected=${result.totalExpectedNotes} extra=${result.extra}`,
      );
    });
  }, [phase, result, attemptType]);

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
      // Capture the exact line + start time for THIS run so persistence records the
      // line that was actually played (retry_slower runs a tempo-shifted copy).
      runLineRef.current = runLine;
      runStartedAtRef.current = Date.now();
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

  // Keyboard transport: Enter => Next line, Space => Start (if idle). Inactive on
  // the stats screen (no transport there) and while onboarding is showing.
  useEffect(() => {
    if (view !== 'practice' || onboarded !== true) return;
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
  }, [handleNextLine, handleStart, isRunning, view, onboarded]);

  const showResults = phase === 'finished' && result !== null;

  // ---- Derived display values for the topbar meta + status bar -------------
  // All cosmetic, read off existing state (no behaviour change).
  const keyLabel = (KEY_CHOICES[uiConfig.keyIndex]?.label ?? 'C major').toUpperCase();
  const posLabel = POSITION_CHOICES[uiConfig.positionIndex]?.label ?? 'V';
  // Compact position token, e.g. "Open (0-4)" -> "OPEN", "V (4-8)" -> "POS.V".
  const posToken = (() => {
    const m = posLabel.match(/^([^(]+)/);
    const head = (m ? m[1] : posLabel).trim();
    return /open/i.test(head) ? 'OPEN' : `POS.${head}`;
  })();
  const bpm = line?.tempo ?? uiConfig.tempo;
  const barCount = line?.barCount ?? uiConfig.barCount;
  // Live "take" number for the tape label — the next line_index the session will
  // persist (1-based for humans).
  const takeNo = lineIndexRef.current + 1;
  // Topbar meta string, DM Mono, mirrors design "LINE 07 / 30 · C MAJOR · POS.5 · ♩ 96".
  const topMeta = `TAKE ${takeNo} · ${keyLabel} · ${posToken} · ♩ ${bpm}`;
  // Live pitch-accuracy readout (so-far): use the finished result when present,
  // otherwise show a dash while reading (the real-time number is committed at the
  // end — we never fabricate a per-frame score).
  const pitchPct = result ? Math.round(result.pitchAccuracy * 100) : null;
  const timingPct = result ? Math.round(result.timingAccuracy * 100) : null;
  // Status-bar phase token + live flag.
  const isLive = phase === 'playing';
  const detectorLabel = (activeDetector ?? detectorKind).toUpperCase();
  // VU meter: drive from the hook's smoothed inputLevel when a live take is
  // running; otherwise let the CSS keyframe animation idle the bars.
  const vuLive = isRunning && inputLevel > 0;

  // Twelve VU bars. When live, each bar's height tracks inputLevel with a fixed
  // per-bar profile (so the meter "shapes" rather than moving in lock-step); the
  // hottest bar tips into flux. When idle, no inline height -> the CSS animation
  // (styles from the design VU) drives them.
  const VU_PROFILE = [0.42, 0.62, 0.5, 0.78, 0.66, 0.9, 1, 0.82, 0.7, 0.56, 0.46, 0.36];

  // Practice body kept as an element value (not a nested component) so toggling
  // the view does not remount the read-along hooks/refs.
  const practiceBody = (
    <>
      <HeadphoneTip />

      {/* --- the sheet / take panel (design .sheet) wrapping OSMD ----------- */}
      <section className="staff-area">
        <span className="sheet-tape">★ TAKE {takeNo} · {attemptLabel(attemptType)}</span>
        <span className="sheet-clef-meta">
          treble · {line ? `${line.timeSignature.beats}/${line.timeSignature.beatUnit}` : '4/4'}
        </span>
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
            {/* Count DOWN (e.g. 4,3,2,1) — remaining beats until the line starts. */}
            <div
              className="countin-number"
              key={countInTotalBeats - countInBeat + 1}
            >
              {countInTotalBeats - countInBeat + 1}
            </div>
            <div className="countin-dots">
              {Array.from({ length: countInTotalBeats }, (_, i) => (
                <span
                  key={i}
                  className={
                    'countin-dot' +
                    (i < countInTotalBeats - countInBeat + 1 ? ' is-current' : '')
                  }
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* --- the console: transport (left) + VU meter & live accuracy (right) */}
      <section className="console">
        <div className="transport">
          <button
            className="btn-play"
            onClick={handleStart}
            disabled={isRunning || !line}
            title="Count-in then play + evaluate (Space)"
          >
            {isRunning ? '● Running…' : '▶ Play line'}
          </button>
          <button
            className="btn btn-small"
            onClick={handleNextLine}
            title="Generate a fresh line (Enter)"
          >
            Next ⏎
          </button>
          <button className="btn btn-small" onClick={stop} disabled={!isRunning}>
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
          {phase === 'countIn' && countInTotalBeats > 0 && (
            <span className="console-countin">
              count-in{' '}
              <b>
                {Array.from(
                  { length: countInTotalBeats },
                  (_, i) => countInTotalBeats - i,
                ).join('·')}
              </b>
            </span>
          )}
        </div>

        <div className="feedback">
          <div className="vu">
            <div className="vu-cap">
              <span>INPUT</span>
              <span className="peak">{vuLive ? 'LIVE' : 'IDLE'}</span>
            </div>
            <div className={'bars' + (vuLive ? ' is-driven' : '')}>
              {VU_PROFILE.map((p, i) => {
                // Live: scale this bar by inputLevel × its profile weight; the
                // loudest profile bar tips into flux above a threshold.
                const h = vuLive
                  ? Math.max(8, Math.min(100, inputLevel * 100 * p * 1.6))
                  : undefined;
                const hot = vuLive && p >= 0.95 && inputLevel * p > 0.45;
                return (
                  <span
                    key={i}
                    className={'bar' + (hot ? ' is-hot' : '')}
                    style={h !== undefined ? { height: `${h}%` } : undefined}
                  />
                );
              })}
            </div>
          </div>
          <div className="score">
            <div className="v">
              {pitchPct === null ? '—' : pitchPct}
              <sup>%</sup>
            </div>
            <div className="l">pitch · {result ? 'take' : 'so far'}</div>
          </div>
        </div>
      </section>

      {/* --- studio status bar (design .statusbar) ------------------------- */}
      <div className="statusbar">
        <span>
          <span className={'live' + (isLive ? '' : ' is-idle')}>● {isLive ? 'LIVE' : phase.toUpperCase()}</span>
          {' · '}detecting ({detectorLabel}) · bar {barCount} / {barCount}
        </span>
        <span className="chips">
          <span>{attemptLabel(attemptType)}</span>
          <span>TIMING {timingPct === null ? '—' : `${timingPct}%`}</span>
          <span
            className="persist-status"
            title={
              persistenceOn
                ? 'Completed attempts are saved to the SQLite DB (Electron main process).'
                : 'Persistence is off (browser preview, or the SQLite DB could not be opened).'
            }
          >
            {persistenceOn ? 'SAVED ●' : 'SAVING OFF'}
          </span>
        </span>
      </div>

      <ConfigPanel config={uiConfig} disabled={isRunning} onChange={setUiConfig} />

      {/* --- Dev tools drawer: synthetic-take harness + detector picker +
              device picker + detected count. Collapsed by default, kept fully
              functional but visually de-emphasised. --------------------------- */}
      <section className="dev-tools" data-open={devToolsOpen ? 'true' : 'false'}>
        <button
          type="button"
          className="dev-tools-toggle"
          aria-expanded={devToolsOpen}
          onClick={() => setDevToolsOpen((o) => !o)}
        >
          <span className="dev-tools-caret">{devToolsOpen ? '▾' : '▸'}</span>
          Dev tools
          <span className="dev-tools-hint">
            synthetic take · detector · input device
          </span>
        </button>

        {devToolsOpen && (
          <div className="dev-tools-body">
            <div className="synthetic-harness">
              <span
                className="synthetic-title"
                title="Drive the whole M4 path with no guitar (Gate-3 preview)"
              >
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
            </div>

            <label
              className="detector-picker"
              title="pitchy (default, fast) vs CREPE (TensorFlow.js, octave-robust). CREPE falls back to pitchy if its model fails to load. Disabled while running."
            >
              Detector:
              <select
                value={detectorKind}
                disabled={isRunning}
                onChange={(e) => handleDetectorChange(e.target.value as DetectorKind)}
              >
                <option value="pitchy">pitchy</option>
                <option value="crepe">CREPE</option>
              </select>
              {isRunning && activeDetector && activeDetector !== detectorKind && (
                <span
                  className="detector-fallback"
                  title="CREPE model failed to load; running pitchy for this take."
                >
                  {' '}(running {activeDetector})
                </span>
              )}
            </label>
            <span className="detected-count">detected: {detectedCount}</span>

            <DevicePicker
              deviceId={inputDeviceId}
              disabled={isRunning}
              onChange={setInputDeviceId}
            />
          </div>
        )}
      </section>

      {showResults && line && result && (
        <ResultsScreen
          line={line}
          result={result}
          attemptType={attemptType}
          review={review}
          onNextLine={handleNextLine}
          onRetryAtTempo={handleRetryAtTempo}
          onRetrySlower={handleRetrySlower}
        />
      )}
    </>
  );

  return (
    <main className="app-shell read-along">
      {/* Scoped structural chrome the global stylesheet does not already own
          (app-window frame, topbar meta, console grid, VU meter, score readout,
          status bar, dev-tools drawer). Palette/fonts/component styles come from
          styles.css; CSP permits style-src 'unsafe-inline'. */}
      <style>{SHELL_CSS}</style>

      <div className="app-window">
        {/* halftone dot-screen texture over the whole window (design
            <div class="tex-half">); content below lifts above it via .z. */}
        <div className="tex-half" aria-hidden="true" />

        {/* First-run onboarding hero (design screen 01). Shown until the
            persisted onboardingComplete flag is set; the topbar/view-switch and
            the practice/stats stages are withheld so the screen is the distinct
            setup hero the design opens on. */}
        {onboarded === false && (
          <div className="stage z onboarding-stage">
            <OnboardingView
              config={uiConfig}
              onChange={setUiConfig}
              inputDeviceId={inputDeviceId}
              onDeviceChange={setInputDeviceId}
              onStart={handleFinishOnboarding}
            />
          </div>
        )}

        {/* The main app (practice / stats), revealed once onboarding is done. */}
        {onboarded === true && (
          <>
            {/* topbar: brand + meta, then the ultramarine accent rule (design) */}
            <header className="app-header topbar z">
              <span className="brand">
                SIGHT <b>READING</b>
              </span>
              <nav className="view-switch" aria-label="View">
                <button
                  className={'btn btn-small' + (view === 'practice' ? ' is-active' : '')}
                  onClick={() => setView('practice')}
                  aria-pressed={view === 'practice'}
                >
                  Practice
                </button>
                <button
                  className={'btn btn-small' + (view === 'stats' ? ' is-active' : '')}
                  onClick={() => setView('stats')}
                  aria-pressed={view === 'stats'}
                >
                  Stats
                </button>
              </nav>
              <span className="meta">
                {view === 'practice'
                  ? topMeta
                  : bridge?.isElectron
                    ? `ELECTRON ${bridge.versions.electron} · CHROMIUM ${bridge.versions.chrome}`
                    : 'BROWSER PREVIEW'}
              </span>
            </header>
            <div className="accent-rule z" />

            {/* Keep the practice body MOUNTED while on stats (hidden) so the
                read-along hooks/refs/audio graph survive a tab switch; only stats
                is conditionally mounted. */}
            <div className="stage z" hidden={view !== 'practice'}>
              {practiceBody}
            </div>
            {view === 'stats' && (
              <div className="stage z">
                <StatsView />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Scoped structural CSS (the "Signal Tape" app-window chrome). styles.css ports
// the palette/fonts + the styled component classes (.btn, .transport, .staff-area,
// .vu .bar via the count-in etc.); this block adds ONLY the layout chrome that
// stylesheet does not define, ported 1:1 from design/app.html + signal-tape.css.
// Kept here because this file is the sole owned surface; CSP allows inline styles.
// -----------------------------------------------------------------------------
const SHELL_CSS = `
  /* The renderer window IS the app: fill it edge-to-edge — no faux window
     chrome, border, card frame, or crop-marks. The bone canvas + halftone
     dot-screen span the entire viewport; content scrolls naturally. */
  .app-window {
    background: var(--paper);
    position: relative;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  /* the halftone dot-screen layer fills the whole window beneath the content
     (.z lifts content above it). */
  .app-window .tex-half { z-index: 1; }

  /* topbar: brand + meta in DM Mono (design .topbar), full-bleed across the
     window; the accent-rule div below it draws the structural ultramarine line. */
  .app-header.topbar {
    align-items: center;
    padding: 18px 34px 14px;
    border-bottom: none;
    margin: 0;
  }
  .app-header.topbar::after { display: none; }   /* use the explicit accent-rule div */
  .app-header.topbar .brand {
    font-family: var(--mono); font-size: 12px; letter-spacing: .22em;
    text-transform: uppercase; font-weight: 500; color: var(--ink);
  }
  .app-header.topbar .brand b { color: var(--blue); }
  .app-header.topbar .meta {
    font-family: var(--mono); font-size: 11px; color: var(--ink-2);
    margin-left: auto; text-align: right;
  }
  .app-header.topbar .view-switch { margin: 0 18px; }

  .accent-rule { height: 3px; background: var(--blue); }

  /* the working stage inside the window */
  .stage {
    display: flex; flex-direction: column; gap: 18px;
    padding: 24px 34px 40px;
  }
  /* the [hidden] HTML attribute must still win over the flex display above so a
     view switch truly collapses the inactive stage (practice stays MOUNTED but
     hidden to preserve its hooks/refs/audio graph). */
  .stage[hidden] { display: none; }
  /* the onboarding hero owns its own padding/gap (design .onb), so its stage
     wrapper sheds the practice-stage padding + flex gap. */
  .stage.onboarding-stage { display: block; padding: 0; gap: 0; }

  /* sheet take/clef tape (design .sheet .tape / .clef-meta) — anchored on the
     .staff-area panel from styles.css. We supersede its ::before tape with an
     explicit, dynamic label element. */
  .staff-area::before { content: none !important; }
  .staff-area .sheet-tape {
    position: absolute; top: -11px; left: 18px; z-index: 2;
    background: var(--flux); color: #fff;
    font-family: var(--mono); font-size: 10px; letter-spacing: .08em;
    padding: 3px 8px; transform: rotate(-1.4deg); box-shadow: 2px 2px 0 var(--ink);
    pointer-events: none;
  }
  .staff-area .sheet-clef-meta {
    position: absolute; top: -10px; right: 14px; z-index: 2;
    background: var(--paper-2); padding: 0 6px;
    font-family: var(--mono); font-size: 10px; color: var(--ink-3);
  }

  /* console: transport (left) + feedback (right) — design .console */
  .console {
    display: grid; grid-template-columns: 1fr auto; gap: 22px; align-items: end;
  }
  @media (max-width: 760px) { .console { grid-template-columns: 1fr; } }

  /* Play slab (design .btn-play) */
  .btn-play {
    display: inline-flex; align-items: center; gap: 9px;
    background: var(--ink); color: var(--paper);
    font-family: var(--disp); font-weight: 900; font-size: 13px;
    letter-spacing: .1em; text-transform: uppercase;
    border: 0; padding: 13px 20px; cursor: pointer; border-radius: var(--r);
    box-shadow: 4px 4px 0 var(--flux);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .btn-play:hover:not(:disabled) { transform: translate(-1px,-1px); box-shadow: 6px 6px 0 var(--flux); }
  .btn-play:disabled { opacity: .5; cursor: default; box-shadow: 4px 4px 0 var(--line); }

  .console-countin { font-family: var(--mono); font-size: 11px; color: var(--ink-3); }
  .console-countin b { color: var(--flux); }

  /* feedback cluster: VU + score (design .feedback / .vu / .score) */
  .feedback { display: flex; align-items: flex-end; gap: 22px; }

  .vu .vu-cap {
    font-family: var(--mono); font-size: 9px; letter-spacing: .14em;
    color: var(--ink-3); display: flex; justify-content: space-between; margin-bottom: 5px;
  }
  .vu .vu-cap .peak { color: var(--flux); }
  .vu .bars {
    display: flex; gap: 3px; align-items: flex-end; height: 48px; width: 192px;
    border-bottom: 1.5px solid var(--ink);
  }
  @media (max-width: 760px) { .vu .bars { width: 100%; } }
  .vu .bar {
    flex: 1; background: var(--blue); min-width: 4px; transform-origin: bottom;
    animation: vu 1.1s ease-in-out infinite alternate;
  }
  /* When driven by inputLevel we set inline heights and pause the idle animation. */
  .vu .bars.is-driven .bar { animation: none; transition: height 90ms linear; }
  .vu .bar.is-hot { background: var(--flux); }
  @keyframes vu { from { transform: scaleY(.55); } to { transform: scaleY(1); } }
  .vu .bars:not(.is-driven) .bar:nth-child(odd) { animation-duration: .9s; }
  .vu .bars:not(.is-driven) .bar:nth-child(3n)  { animation-duration: 1.4s; }
  .vu .bars:not(.is-driven) .bar:nth-child(5n)  { animation-duration: .7s; }

  .score { text-align: right; }
  .score .v {
    font-family: var(--disp); font-weight: 900; font-size: 48px; line-height: .85;
    letter-spacing: -0.04em; color: var(--ink);
  }
  .score .v sup { font-size: 16px; color: var(--blue); }
  .score .l {
    font-family: var(--mono); font-size: 10px; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ink-3); margin-top: 4px;
  }

  /* status bar (design .statusbar) */
  .statusbar {
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid var(--line); padding: 12px 0 2px;
    font-family: var(--mono); font-size: 11px; color: var(--ink-2);
  }
  .statusbar .live { color: var(--flux); }
  .statusbar .live.is-idle { color: var(--ink-3); }
  .statusbar .chips { display: flex; gap: 14px; align-items: center; }
  .statusbar .persist-status { color: var(--ink-3); }

  /* Dev tools drawer — quiet, recessed, collapsed by default. */
  .dev-tools {
    border: 1.5px dashed var(--ink-3); border-radius: var(--r);
    background: var(--paper-3); opacity: .9;
  }
  .dev-tools[data-open="true"] { opacity: 1; }
  .dev-tools-toggle {
    display: flex; align-items: center; gap: 10px; width: 100%;
    background: transparent; border: 0; cursor: pointer; text-align: left;
    padding: 10px 16px;
    font-family: var(--mono); font-size: 12px; letter-spacing: .04em; color: var(--ink-2);
  }
  .dev-tools-toggle:hover { color: var(--ink); }
  .dev-tools-caret { color: var(--ink-3); width: 1em; }
  .dev-tools-hint { color: var(--ink-3); margin-left: auto; font-size: 11px; }
  .dev-tools-body {
    display: flex; flex-direction: column; gap: 14px;
    padding: 4px 16px 16px;
  }
  /* inside the drawer the harness sheds its own border (the drawer frames it) */
  .dev-tools-body .synthetic-harness { border: 0; background: transparent; padding: 0; opacity: 1; }
`;
