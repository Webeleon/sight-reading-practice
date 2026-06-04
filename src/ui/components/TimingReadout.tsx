// TimingReadout — on-screen evidence panel for the metronome-driven cursor.
//
// Disposable UI layer. Shows the live phase (count-in / playing / finished), the
// current note index vs total, the count-in beat, and — the Gate-2 number — the
// measured deviation between when the cursor reached the end and the expected
// wall-clock time. |deviation| <= 20ms is the brief's acceptance criterion.

import React from 'react';
import type { TimingReadout as Readout } from '../useReadAlong.js';

export interface TimingReadoutProps {
  readout: Readout;
  tempo: number;
}

export function TimingReadout({
  readout,
  tempo,
}: TimingReadoutProps): React.JSX.Element {
  const dev = readout.finalDeviationMs;
  const devPass = dev !== null && Math.abs(dev) <= 20;

  return (
    <div className="timing-readout">
      <div className="readout-row">
        <span className="readout-label">Phase</span>
        <span className={`readout-value phase-${readout.phase}`}>
          {phaseLabel(readout)}
        </span>
      </div>
      <div className="readout-row">
        <span className="readout-label">Elapsed</span>
        <span className="readout-value">{readout.elapsedMs.toFixed(0)} ms</span>
      </div>
      <div className="readout-row">
        <span className="readout-label">Note</span>
        <span className="readout-value">
          {readout.currentNoteIndex < 0
            ? '—'
            : `${readout.currentNoteIndex + 1} / ${readout.totalNotes}`}
        </span>
      </div>
      <div className="readout-row">
        <span className="readout-label">Tempo</span>
        <span className="readout-value">{tempo} BPM</span>
      </div>
      <div className="readout-row">
        <span className="readout-label">Final deviation</span>
        <span
          className={
            dev === null
              ? 'readout-value'
              : devPass
                ? 'readout-value dev-pass'
                : 'readout-value dev-fail'
          }
        >
          {dev === null
            ? '—'
            : `${dev >= 0 ? '+' : ''}${dev.toFixed(1)} ms ${devPass ? '(PASS ≤20ms)' : '(FAIL >20ms)'}`}
        </span>
      </div>
    </div>
  );
}

function phaseLabel(r: Readout): string {
  switch (r.phase) {
    case 'idle':
      return 'Idle';
    case 'countIn':
      return `Count-in ${r.countInBeat} / ${r.countInBeats}`;
    case 'playing':
      return 'Playing';
    case 'finished':
      return 'Finished';
  }
}
