// ResultsScreen — post-line results panel (brief section 13).
//
// Disposable UI layer (functional, not polished). Shows pitch accuracy %, timing
// accuracy %, the configured tempo, a config summary, and the three actions in
// priority order: Next line (primary, keyboard-shortcut-able) / Retry at tempo /
// Retry slower. The retry actions carry the attempt_type the orchestrator logs
// (and Milestone 5 will persist): retry_at_tempo / retry_slower are excluded from
// fluency stats; only first_read counts (brief section 11).

import React from 'react';
import type { Line } from '../../domain/index.js';
import type { EvaluationResult } from '../../evaluation/index.js';

/** attempt_type values (brief section 11). Only first_read counts toward fluency. */
export type AttemptType = 'first_read' | 'retry_at_tempo' | 'retry_slower';

export interface ResultsScreenProps {
  line: Line;
  result: EvaluationResult;
  /** The attempt_type that PRODUCED this result (so the human sees what they ran). */
  attemptType: AttemptType;
  /** Generate + read a brand-new line (logged first_read). Primary action. */
  onNextLine: () => void;
  /** Re-read the SAME line at the same tempo (logged retry_at_tempo). */
  onRetryAtTempo: () => void;
  /** Re-read the SAME line slower (logged retry_slower). */
  onRetrySlower: () => void;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function keyLabel(line: Line): string {
  const t = line.key.tonic;
  const acc =
    t.accidental === 'sharp'
      ? '#'
      : t.accidental === 'flat'
        ? 'b'
        : t.accidental === 'doubleSharp'
          ? 'x'
          : t.accidental === 'doubleFlat'
            ? 'bb'
            : '';
  return `${t.name}${acc} ${line.key.mode}`;
}

export function ResultsScreen({
  line,
  result,
  attemptType,
  onNextLine,
  onRetryAtTempo,
  onRetrySlower,
}: ResultsScreenProps): React.JSX.Element {
  return (
    <div className="results-screen">
      <div className="results-header">
        <h2>Results</h2>
        <span className="results-attempt">attempt: {attemptType}</span>
      </div>

      <div className="results-metrics">
        <div className="metric metric-pitch">
          <div className="metric-value">{pct(result.pitchAccuracy)}</div>
          <div className="metric-label">Pitch accuracy</div>
          <div className="metric-sub">
            (hits + late) / {result.totalExpectedNotes}
          </div>
        </div>
        <div className="metric metric-timing">
          <div className="metric-value">{pct(result.timingAccuracy)}</div>
          <div className="metric-label">Timing accuracy</div>
          <div className="metric-sub">
            hits / {result.totalExpectedNotes}
          </div>
        </div>
      </div>

      <div className="results-breakdown">
        <span className="chip chip-hit">{result.hits} hit</span>
        <span className="chip chip-wrong">{result.wrongPitch} wrong</span>
        <span className="chip chip-late">{result.late} late</span>
        <span className="chip chip-missed">{result.missed} missed</span>
        <span className="chip chip-extra">{result.extra} extra</span>
      </div>

      <div className="results-config">
        <span>{keyLabel(line)}</span>
        <span>·</span>
        <span>{line.position.label ?? 'pos'} position</span>
        <span>·</span>
        <span>{line.barCount} bars</span>
        <span>·</span>
        <span>{line.tempo} BPM</span>
      </div>

      <div className="results-actions">
        <button
          className="btn btn-primary"
          onClick={onNextLine}
          title="Generate a fresh line (Enter) — counts toward fluency"
          autoFocus
        >
          Next line ⏎
        </button>
        <button
          className="btn"
          onClick={onRetryAtTempo}
          title="Re-read this line at the same tempo (excluded from fluency stats)"
        >
          Retry at tempo
        </button>
        <button
          className="btn"
          onClick={onRetrySlower}
          title="Re-read this line slower (excluded from fluency stats)"
        >
          Retry slower
        </button>
      </div>
    </div>
  );
}
