// DetectionReview — the POST-TAKE detection-review screen (Gate-3 validation tool).
//
// Disposable UI layer (brief sections 2 & 5): React/DOM/Web-Audio allowed here.
// This component is the IMPURE consumer of the PURE delta helpers in
// src/evaluation/review.ts (buildReviewModel) and the in-memory ReviewPayload the
// read-AND-evaluate hook (useSightReading) produces per run. It NEVER recomputes
// alignment or pitch math — it just renders what the pure layer already decided —
// and it holds NOTHING in persistence (everything is in-memory for the session).
//
// Three sections (the human picked all three):
//   1. PER-NOTE TABLE   — one row per EXPECTED note from buildReviewModel: expected
//      pitch | detected pitch | pitch error (CENTS when the detection carried a
//      freqHz, else +/- semitones; octave errors flagged) | timing (ms, signed:
//      + late / - early) | classification (colour-coded to match the staff).
//      Extra detections (no expected counterpart) are listed below.
//   2. PITCH-VS-TIME    — an inline SVG (no chart lib): X = time(ms) over the take,
//      Y = MIDI (auto-ranged to the notes +/- a few semitones). Each EXPECTED note
//      is a horizontal bar (onset..onset+duration at its MIDI); the DETECTED pitch
//      is overlaid as a CONTINUOUS polyline from frames[] (LIVE) or DISCRETE dots
//      at (onsetMs, midi) (SYNTHETIC). Octave errors + timing drift become visible.
//   3. AUDIO PLAYBACK   — when a recording Blob is present (LIVE mic take) an
//      <audio controls> from an object URL (revoked on unmount). HIDDEN entirely
//      when there is no recording (SYNTHETIC / no mic).
//
// SYNTHETIC vs LIVE: a synthetic take has frames=[] and recording=null, so the
// graph draws discrete dots and the audio player is hidden; everything else (the
// table, the expected bars, the discrete detected points) still renders. A live
// take has the continuous trace + the recording.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildReviewModel, type ReviewRow } from '../../evaluation/index.js';
import type { ReviewPayload } from '../useSightReading.js';
import type { EvaluationResult } from '../../evaluation/index.js';
import { FEEDBACK_COLORS } from './OsmdView.js';
import type { DetectionFrame } from '../../audio/index.js';

export interface DetectionReviewProps {
  /** The authoritative evaluation result (source of classification + pairing). */
  result: EvaluationResult;
  /** The in-memory per-run payload: frames + detected + recording + expected. */
  review: ReviewPayload;
}

// --- small pure-ish label helpers (UI-local; key-agnostic, sharps) -----------

const PITCH_CLASS_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** A key-agnostic MIDI label (e.g. 60 -> "C4"), sharps only. The review is a
 *  detector-accuracy tool, not notation, so a plain spelling is the right call
 *  (key-aware spelling lives in the domain layer; we deliberately don't pull it
 *  in here). */
function midiLabel(midi: number): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${PITCH_CLASS_NAMES[pc]}${octave}`;
}

/** Signed ms with an explicit + on late values (so "+late / -early" reads at a
 *  glance). null -> em dash. */
function signedMs(ms: number | null): string {
  if (ms === null) return '—';
  const r = Math.round(ms);
  return r > 0 ? `+${r}` : `${r}`;
}

/** The pitch-error cell text: prefer exact cents (live), else +/- semitones
 *  (synthetic), else em dash (missed). */
function pitchErrorText(row: ReviewRow): string {
  if (row.detectedMidi === null) return '—';
  if (row.pitchErrorCents !== null && Number.isFinite(row.pitchErrorCents)) {
    const c = Math.round(row.pitchErrorCents);
    return `${c > 0 ? '+' : ''}${c}¢`;
  }
  const s = row.pitchErrorSemitones;
  if (s === null) return '—';
  if (s === 0) return '0';
  return `${s > 0 ? '+' : ''}${s} st`;
}

/** Map a classification to the SAME feedback colour family as the staff. `late`
 *  reads as the hit (green) colour because the pitch was right — its fault is the
 *  timing column. */
function classColor(classification: ReviewRow['classification']): string {
  switch (classification) {
    case 'hit':
      return FEEDBACK_COLORS.hit;
    case 'late':
      return FEEDBACK_COLORS.hit;
    case 'wrong_pitch':
      return FEEDBACK_COLORS.wrong;
    case 'missed':
      return FEEDBACK_COLORS.missed;
    case 'extra':
      return '#748ffc';
  }
}

// --- SVG pitch-vs-time graph -------------------------------------------------

const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT = 280;
const PAD_LEFT = 44; // room for MIDI labels
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28; // room for time labels
const MIDI_MARGIN = 3; // pad the MIDI range a few semitones either side

interface GraphBounds {
  minMs: number;
  maxMs: number;
  minMidi: number;
  maxMidi: number;
}

/** Compute the time + MIDI bounds covering every expected bar and detected point
 *  (continuous frames if present, else the discrete detections). Falls back to a
 *  sane window when there is nothing to draw. */
function computeBounds(
  review: ReviewPayload,
  usableFrames: DetectionFrame[],
): GraphBounds {
  let minMs = Infinity;
  let maxMs = -Infinity;
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  for (const e of review.expected) {
    minMs = Math.min(minMs, e.onsetMs);
    maxMs = Math.max(maxMs, e.onsetMs + e.durationMs);
    minMidi = Math.min(minMidi, e.expectedMidi);
    maxMidi = Math.max(maxMidi, e.expectedMidi);
  }
  for (const d of review.detected) {
    minMs = Math.min(minMs, d.onsetMs);
    maxMs = Math.max(maxMs, d.onsetMs);
    minMidi = Math.min(minMidi, d.midi);
    maxMidi = Math.max(maxMidi, d.midi);
  }
  for (const f of usableFrames) {
    minMs = Math.min(minMs, f.tMs);
    maxMs = Math.max(maxMs, f.tMs);
    minMidi = Math.min(minMidi, f.midi);
    maxMidi = Math.max(maxMidi, f.midi);
  }

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    minMs = 0;
    maxMs = 1000;
  }
  if (!Number.isFinite(minMidi) || !Number.isFinite(maxMidi)) {
    minMidi = 55;
    maxMidi = 67;
  }
  if (maxMs <= minMs) maxMs = minMs + 1000;

  return {
    minMs,
    maxMs,
    minMidi: Math.floor(minMidi) - MIDI_MARGIN,
    maxMidi: Math.ceil(maxMidi) + MIDI_MARGIN,
  };
}

function PitchTimeGraph({
  review,
}: {
  review: ReviewPayload;
}): React.JSX.Element {
  // A frame is "usable" only when pitchy found a real pitch (silent frames carry
  // freqHz 0 / midi NaN — skip them so the trace doesn't snap to zero).
  const usableFrames = useMemo(
    () =>
      review.frames.filter(
        (f) => Number.isFinite(f.midi) && f.freqHz > 0,
      ),
    [review.frames],
  );

  const bounds = useMemo(
    () => computeBounds(review, usableFrames),
    [review, usableFrames],
  );

  const plotW = GRAPH_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = GRAPH_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xOf = (ms: number): number =>
    PAD_LEFT +
    ((ms - bounds.minMs) / (bounds.maxMs - bounds.minMs)) * plotW;
  // MIDI grows UP the screen, so invert Y.
  const yOf = (midi: number): number =>
    PAD_TOP +
    (1 - (midi - bounds.minMidi) / (bounds.maxMidi - bounds.minMidi)) * plotH;

  // Horizontal MIDI gridlines (one per semitone if the span is small, else every
  // few semitones so labels don't crowd).
  const midiSpan = bounds.maxMidi - bounds.minMidi;
  const midiStep = midiSpan <= 16 ? 1 : midiSpan <= 32 ? 2 : 4;
  const midiLines: number[] = [];
  for (let m = bounds.minMidi; m <= bounds.maxMidi; m += midiStep) {
    midiLines.push(m);
  }

  // Vertical time gridlines: ~6 evenly spaced ticks across the span.
  const TIME_TICKS = 6;
  const timeLines: number[] = [];
  for (let i = 0; i <= TIME_TICKS; i++) {
    timeLines.push(bounds.minMs + ((bounds.maxMs - bounds.minMs) * i) / TIME_TICKS);
  }

  // The continuous detected trace (LIVE). We break the polyline into segments
  // wherever there is a time gap (> ~120ms) so a silence doesn't draw a straight
  // line across unrelated pitches.
  const FRAME_GAP_MS = 120;
  const traceSegments: DetectionFrame[][] = useMemo(() => {
    const segs: DetectionFrame[][] = [];
    let cur: DetectionFrame[] = [];
    let prevT = -Infinity;
    for (const f of usableFrames) {
      if (f.tMs - prevT > FRAME_GAP_MS && cur.length > 0) {
        segs.push(cur);
        cur = [];
      }
      cur.push(f);
      prevT = f.tMs;
    }
    if (cur.length > 0) segs.push(cur);
    return segs;
  }, [usableFrames]);

  const isLive = usableFrames.length > 0;

  return (
    <div className="review-graph-wrap">
      <svg
        className="review-graph"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label="Detected pitch over time vs expected notes"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* MIDI gridlines + labels */}
        {midiLines.map((m) => (
          <g key={`midi-${m}`}>
            <line
              x1={PAD_LEFT}
              y1={yOf(m)}
              x2={GRAPH_WIDTH - PAD_RIGHT}
              y2={yOf(m)}
              className="review-grid"
            />
            <text x={4} y={yOf(m) + 4} className="review-axis-label">
              {midiLabel(m)}
            </text>
          </g>
        ))}

        {/* Time gridlines + labels */}
        {timeLines.map((t, i) => (
          <g key={`t-${i}`}>
            <line
              x1={xOf(t)}
              y1={PAD_TOP}
              x2={xOf(t)}
              y2={GRAPH_HEIGHT - PAD_BOTTOM}
              className="review-grid"
            />
            <text
              x={xOf(t)}
              y={GRAPH_HEIGHT - 10}
              className="review-axis-label"
              textAnchor="middle"
            >
              {Math.round(t)}ms
            </text>
          </g>
        ))}

        {/* Expected notes: a horizontal bar from onset..onset+duration at MIDI. */}
        {review.expected.map((e) => (
          <line
            key={`exp-${e.noteIndex}`}
            x1={xOf(e.onsetMs)}
            y1={yOf(e.expectedMidi)}
            x2={xOf(e.onsetMs + e.durationMs)}
            y2={yOf(e.expectedMidi)}
            className="review-expected-bar"
          />
        ))}

        {/* Detected pitch over time: continuous polyline(s) (LIVE) ... */}
        {traceSegments.map((seg, i) => (
          <polyline
            key={`trace-${i}`}
            className="review-trace"
            points={seg.map((f) => `${xOf(f.tMs)},${yOf(f.midi)}`).join(' ')}
          />
        ))}

        {/* ... and discrete dots at each committed detection (BOTH modes — they
            mark the actual onsets the evaluator used; in SYNTHETIC mode they are
            the ONLY detected geometry). */}
        {review.detected.map((d, i) => (
          <circle
            key={`det-${i}`}
            cx={xOf(d.onsetMs)}
            cy={yOf(d.midi)}
            r={3.5}
            className="review-detected-dot"
          />
        ))}
      </svg>

      <div className="review-graph-legend">
        <span className="review-legend-item">
          <span className="review-legend-bar" /> expected
        </span>
        {isLive && (
          <span className="review-legend-item">
            <span className="review-legend-trace" /> detected trace (live)
          </span>
        )}
        <span className="review-legend-item">
          <span className="review-legend-dot" /> detected onset
          {isLive ? '' : ' (synthetic)'}
        </span>
      </div>
    </div>
  );
}

// --- audio playback ----------------------------------------------------------

function RecordingPlayer({ blob }: { blob: Blob }): React.JSX.Element {
  // Create the object URL once per blob and REVOKE it on unmount / blob change so
  // we never leak. In-memory only — nothing is persisted.
  const [url, setUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    console.log(
      `[UI] review: created object URL for recording (${blob.size} bytes, ${blob.type})`,
    );
    return () => {
      URL.revokeObjectURL(u);
      console.log('[UI] review: revoked recording object URL');
    };
  }, [blob]);

  // MediaRecorder WebM blobs carry no duration in their container, so a plain
  // <audio> shows 0:00 / 0:00 and the seek bar is dead (it still PLAYS, but it
  // looks broken). Force Chromium to compute the real duration: once metadata
  // loads, if duration is Infinity/NaN, seek far past the end and reset to 0 — the
  // browser then knows the true length and seeking works.
  const forceDuration = useCallback((): void => {
    const a = audioRef.current;
    if (!a) return;
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      const onTimeUpdate = (): void => {
        a.removeEventListener('timeupdate', onTimeUpdate);
        a.currentTime = 0;
      };
      a.addEventListener('timeupdate', onTimeUpdate);
      a.currentTime = 1e101; // seek absurdly far -> browser clamps + learns duration
    }
  }, []);

  return (
    <section className="review-section review-audio">
      <h4>Recording</h4>
      {url ? (
        <audio
          ref={audioRef}
          controls
          src={url}
          onLoadedMetadata={forceDuration}
          className="review-audio-player"
        >
          Your browser does not support inline audio playback.
        </audio>
      ) : (
        <span className="review-empty">preparing audio…</span>
      )}
    </section>
  );
}

// --- main component ----------------------------------------------------------

export function DetectionReview({
  result,
  review,
}: DetectionReviewProps): React.JSX.Element {
  // The PURE delta model: one row per expected note + the leftover extras. Rebuilt
  // only when the result/detected change (a new run produces new objects).
  const model = useMemo(
    () => buildReviewModel(result, review.detected),
    [result, review.detected],
  );

  const isLive = review.frames.some(
    (f) => Number.isFinite(f.midi) && f.freqHz > 0,
  );

  return (
    <div className="detection-review">
      <div className="review-header">
        <h3>Detection detail</h3>
        <span className="review-mode" title="LIVE has mic frames + recording; SYNTHETIC has neither">
          mode: {isLive ? 'live' : 'synthetic'} · frames: {review.frames.length} ·
          detected: {review.detected.length}
        </span>
      </div>

      {/* 1. PER-NOTE TABLE */}
      <section className="review-section">
        <h4>Per-note table</h4>
        <table className="review-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Expected</th>
              <th>Detected</th>
              <th>Pitch err</th>
              <th>Timing</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.noteIndex}
                className={
                  'review-row review-row-' + row.classification +
                  (row.isOctaveError ? ' review-row-octave' : '')
                }
              >
                <td className="review-cell-index">{row.noteIndex}</td>
                <td>{midiLabel(row.expectedMidi)}</td>
                <td>
                  {row.detectedMidi === null ? '—' : midiLabel(row.detectedMidi)}
                  {row.isOctaveError && (
                    <span className="review-octave-flag" title="Right pitch class, wrong octave (detector artifact)">
                      {' '}8va
                    </span>
                  )}
                </td>
                <td className="review-cell-num">{pitchErrorText(row)}</td>
                <td className="review-cell-num">{signedMs(row.timingErrorMs)}</td>
                <td>
                  <span
                    className="review-class-pill"
                    style={{ color: classColor(row.classification) }}
                  >
                    {row.classification}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {model.extras.length > 0 && (
          <div className="review-extras">
            <h5>
              Extra detections{' '}
              <span className="review-extras-sub">(no expected counterpart)</span>
            </h5>
            <table className="review-table review-table-extras">
              <thead>
                <tr>
                  <th>Detected</th>
                  <th>Onset</th>
                  <th>Freq</th>
                </tr>
              </thead>
              <tbody>
                {model.extras.map((ex, i) => (
                  <tr key={`extra-${i}`} className="review-row review-row-extra">
                    <td>{midiLabel(ex.detectedMidi)}</td>
                    <td className="review-cell-num">
                      {Math.round(ex.detectedOnsetMs)}ms
                    </td>
                    <td className="review-cell-num">
                      {ex.detectedFreqHz === null
                        ? '—'
                        : `${ex.detectedFreqHz.toFixed(1)} Hz`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {model.rows.length === 0 && model.extras.length === 0 && (
          <span className="review-empty">no notes in this take</span>
        )}
      </section>

      {/* 2. PITCH-VS-TIME GRAPH */}
      <section className="review-section">
        <h4>Pitch vs time</h4>
        <PitchTimeGraph review={review} />
      </section>

      {/* 3. AUDIO PLAYBACK — only when a recording exists (LIVE mic take). */}
      {review.recording && <RecordingPlayer blob={review.recording} />}
    </div>
  );
}
