// StatsView.tsx — the Milestone-5 statistics screen (two views, brief M5).
//
// Disposable UI layer. Reads ALL data via the stats IPC (statsBridge.ts) — the
// renderer never touches better-sqlite3. Two sub-views:
//   (a) AccuracyOverTime — pitch & timing accuracy over time, filterable by KEY
//       (key_tonic + key_mode) and POSITION (fret window). A plain SVG line chart.
//   (b) MissedNoteHeatmap — per-pitch missed/wrong rate as a staff/pitch heatmap
//       (a column of cells from low MIDI to high, coloured by miss rate).
//
// Functional/ugly is correct (brief section 2). Both honour the SAME key/position
// filter so the staff heatmap matches the plotted series.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAccuracyOverTime,
  fetchMissedNoteHeatmap,
  fetchAvailableKeys,
  fetchAvailablePositions,
  statsAvailable,
  type AccuracyPoint,
  type PitchHeatmapBucket,
  type KeyOption,
  type PositionOption,
  type StatsFilter,
} from '../statsBridge.js';

// --- shared filter UI -------------------------------------------------------

interface FilterState {
  keyIndex: number; // -1 == all keys
  positionIndex: number; // -1 == all positions
}

function buildFilter(
  state: FilterState,
  keys: KeyOption[],
  positions: PositionOption[],
): StatsFilter {
  const filter: StatsFilter = {};
  const k = keys[state.keyIndex];
  if (k) {
    filter.keyTonic = k.keyTonic;
    filter.keyMode = k.keyMode;
  }
  const p = positions[state.positionIndex];
  if (p) {
    filter.positionFretLow = p.positionFretLow;
    filter.positionFretHigh = p.positionFretHigh;
  }
  return filter;
}

// --- (a) accuracy-over-time chart -------------------------------------------

const CHART_W = 720;
const CHART_H = 240;
const PAD = 36;

function AccuracyChart({ points }: { points: AccuracyPoint[] }): React.JSX.Element {
  if (points.length === 0) {
    return <p className="stats-empty">No first-read attempts match this filter yet.</p>;
  }

  // x = index in the time-ordered series (even spacing reads more clearly than
  // raw wall-clock gaps for a practice log). y = accuracy in [0,1].
  const n = points.length;
  const x = (i: number): number =>
    n === 1 ? PAD : PAD + (i * (CHART_W - 2 * PAD)) / (n - 1);
  const y = (v: number): number => CHART_H - PAD - v * (CHART_H - 2 * PAD);

  const lineFor = (sel: (p: AccuracyPoint) => number | null): string =>
    points
      .map((p, i) => {
        const v = sel(p);
        return v === null ? null : `${x(i)},${y(v)}`;
      })
      .filter((s): s is string => s !== null)
      .map((s, i) => (i === 0 ? `M${s}` : `L${s}`))
      .join(' ');

  return (
    <div>
      <svg
        className="stats-chart"
        width={CHART_W}
        height={CHART_H}
        role="img"
        aria-label="Accuracy over time"
      >
        {/* gridlines at 0/25/50/75/100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD}
              x2={CHART_W - PAD}
              y1={y(g)}
              y2={y(g)}
              stroke="#333"
              strokeDasharray="2 3"
            />
            <text x={4} y={y(g) + 4} fill="#888" fontSize={11}>
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        <path d={lineFor((p) => p.pitchAccuracy)} fill="none" stroke="#4caf50" strokeWidth={2} />
        <path d={lineFor((p) => p.timingAccuracy)} fill="none" stroke="#2196f3" strokeWidth={2} />
        {points.map((p, i) => (
          <g key={p.attemptId}>
            {p.pitchAccuracy !== null && (
              <circle cx={x(i)} cy={y(p.pitchAccuracy)} r={3} fill="#4caf50" />
            )}
            {p.timingAccuracy !== null && (
              <circle cx={x(i)} cy={y(p.timingAccuracy)} r={3} fill="#2196f3" />
            )}
          </g>
        ))}
      </svg>
      <div className="stats-legend">
        <span className="legend-swatch" style={{ background: '#4caf50' }} /> pitch accuracy
        <span className="legend-swatch" style={{ background: '#2196f3', marginLeft: 16 }} /> timing accuracy
        <span style={{ marginLeft: 16, color: '#888' }}>({n} attempt{n === 1 ? '' : 's'})</span>
      </div>
    </div>
  );
}

// --- (b) missed-note staff heatmap ------------------------------------------

/** Heat colour for a miss rate in [0,1]: green (clean) -> red (often missed). */
function heatColor(missRate: number): string {
  const hue = Math.round((1 - missRate) * 120); // 120=green, 0=red
  return `hsl(${hue}, 70%, 45%)`;
}

function MissedNoteHeatmap({
  buckets,
}: {
  buckets: PitchHeatmapBucket[];
}): React.JSX.Element {
  if (buckets.length === 0) {
    return <p className="stats-empty">No expected notes match this filter yet.</p>;
  }
  // Buckets arrive low MIDI -> high; show HIGH at the top (like a staff).
  const ordered = [...buckets].reverse();
  return (
    <div className="heatmap" role="table" aria-label="Missed-note heatmap by pitch">
      <div className="heatmap-row heatmap-head" role="row">
        <span className="heatmap-cell pitch">pitch</span>
        <span className="heatmap-cell">total</span>
        <span className="heatmap-cell">hit</span>
        <span className="heatmap-cell">missed</span>
        <span className="heatmap-cell">wrong</span>
        <span className="heatmap-cell">late</span>
        <span className="heatmap-cell heat">miss rate</span>
      </div>
      {ordered.map((b) => (
        <div className="heatmap-row" role="row" key={b.expectedMidi}>
          <span className="heatmap-cell pitch">
            {b.expectedPitchName ?? `midi ${b.expectedMidi}`}
          </span>
          <span className="heatmap-cell">{b.total}</span>
          <span className="heatmap-cell">{b.hits}</span>
          <span className="heatmap-cell">{b.missed}</span>
          <span className="heatmap-cell">{b.wrongPitch}</span>
          <span className="heatmap-cell">{b.late}</span>
          <span
            className="heatmap-cell heat"
            style={{ background: heatColor(b.missRate) }}
            title={`${b.missed} missed + ${b.wrongPitch} wrong of ${b.total}`}
          >
            {Math.round(b.missRate * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// --- the view ---------------------------------------------------------------

export function StatsView(): React.JSX.Element {
  const [keys, setKeys] = useState<KeyOption[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [filterState, setFilterState] = useState<FilterState>({
    keyIndex: -1,
    positionIndex: -1,
  });
  const [points, setPoints] = useState<AccuracyPoint[]>([]);
  const [buckets, setBuckets] = useState<PitchHeatmapBucket[]>([]);
  const [loading, setLoading] = useState(true);

  const available = statsAvailable();

  // Load the filter dropdown options once.
  useEffect(() => {
    void (async () => {
      const [k, p] = await Promise.all([
        fetchAvailableKeys(),
        fetchAvailablePositions(),
      ]);
      setKeys(k);
      setPositions(p);
    })();
  }, []);

  const filter = useMemo(
    () => buildFilter(filterState, keys, positions),
    [filterState, keys, positions],
  );

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [series, heat] = await Promise.all([
      fetchAccuracyOverTime(filter),
      fetchMissedNoteHeatmap(filter),
    ]);
    setPoints(series);
    setBuckets(heat);
    setLoading(false);
  }, [filter]);

  // Reload whenever the filter changes.
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="stats-view">
      <header className="stats-header">
        <h2>Practice stats</h2>
        <p className="subtitle">
          First-read attempts only (retries excluded from fluency).
        </p>
      </header>

      {!available && (
        <p className="stats-warning">
          Stats are read from the SQLite DB in the Electron main process. Running
          outside Electron (browser preview), so there is no data to show. Launch
          the app with <code>npm run dev</code> (it electron-rebuilds first).
        </p>
      )}

      <div className="stats-filters">
        <label>
          Key
          <select
            value={filterState.keyIndex}
            onChange={(e) =>
              setFilterState((s) => ({ ...s, keyIndex: Number(e.target.value) }))
            }
          >
            <option value={-1}>All keys</option>
            {keys.map((k, i) => (
              <option key={`${k.keyTonic}-${k.keyMode}`} value={i}>
                {k.keyTonic} {k.keyMode}
              </option>
            ))}
          </select>
        </label>
        <label>
          Position
          <select
            value={filterState.positionIndex}
            onChange={(e) =>
              setFilterState((s) => ({
                ...s,
                positionIndex: Number(e.target.value),
              }))
            }
          >
            <option value={-1}>All positions</option>
            {positions.map((p, i) => (
              <option
                key={`${p.positionFretLow}-${p.positionFretHigh}`}
                value={i}
              >
                {p.positionLabel ?? 'pos'} ({p.positionFretLow}-{p.positionFretHigh})
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-small" onClick={() => void reload()}>
          Refresh
        </button>
        {loading && <span className="stats-loading">loading…</span>}
      </div>

      <div className="stats-panel">
        <h3>Accuracy over time</h3>
        <AccuracyChart points={points} />
      </div>

      <div className="stats-panel">
        <h3>Missed-note heatmap (by pitch)</h3>
        <MissedNoteHeatmap buckets={buckets} />
      </div>
    </section>
  );
}
