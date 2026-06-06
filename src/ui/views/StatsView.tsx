// StatsView.tsx — the Milestone-5 statistics screen, restyled to the "Signal
// Tape" PROGRESS dashboard (design/app.html screen 04).
//
// Disposable UI layer. Reads ALL data via the stats IPC (statsBridge.ts) — the
// renderer never touches the SQLite driver. The behaviour is unchanged: same
// IPC (fetchAccuracyOverTime / fetchMissedNoteHeatmap / fetchAvailableKeys /
// fetchAvailablePositions) and the same KEY/POSITION filters. This file only
// restyles the markup and DERIVES presentation-only summaries from the data we
// already fetch — it introduces NO new IPC.
//
//   (a) totals strip — lines read / practice days / best streak / avg pitch,
//       all derived from the accuracy points already on screen. A tile is
//       OMITTED (not fabricated) when its value isn't derivable.
//   (b) AccuracyOverTime — Signal-Tape trend: an ultramarine pitch line over a
//       faint ultramarine area, the latest point a flux marker (the "live"
//       reading), DM-Mono axes. Timing rides along as a quiet secondary line so
//       flux stays reserved for the live note.
//   (c) practice calendar — a last-N-days streak grid, derived from the attempt
//       timestamps (nice-to-have; only shown when there are dated attempts).
//   (d) MissedNoteHeatmap — per-pitch miss rate on a green→flux scale.
//
// Both (b) and (d) honour the SAME key/position filter so the staff heatmap
// matches the plotted series.
//
// STYLING NOTE: this file is the only one in scope, so the dashboard-specific
// look (totals grid, calendar, trend line/area colours) is expressed with inline
// styles bound to the shared "Signal Tape" CSS variables (--ink, --blue, --flux,
// --line, --ok, --warn, --paper*, --mono). Layout that already exists in
// styles.css (.stats-panel / .stats-chart / .stats-legend / .heatmap*) is reused
// as-is rather than re-declared.

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

// --- derived presentation summaries (NO new IPC) ----------------------------
//
// Everything below is computed purely from the AccuracyPoint[] we already fetch.
// `startedAt` is an epoch-ms timestamp; we bucket it into local calendar days to
// derive practice days / streaks / a calendar grid.

const DAY_MS = 86_400_000;

/** Local calendar-day index (days since the unix epoch in the local zone). */
function dayIndex(epochMs: number): number {
  const d = new Date(epochMs);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS,
  );
}

interface Totals {
  linesRead: number;
  practiceDays: number;
  /** longest run of consecutive practiced days, in days */
  bestStreak: number;
  /** mean pitch accuracy over the last 7 practiced calendar days, or null */
  avgPitch7d: number | null;
}

function deriveTotals(points: AccuracyPoint[]): Totals {
  const days = new Set<number>();
  for (const p of points) days.add(dayIndex(p.startedAt));
  const sorted = [...days].sort((a, b) => a - b);

  // longest consecutive-day run
  let bestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    prev = d;
  }

  // avg pitch over the most-recent 7 practiced days present in the data
  const recentDays = new Set(sorted.slice(-7));
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (p.pitchAccuracy !== null && recentDays.has(dayIndex(p.startedAt))) {
      sum += p.pitchAccuracy;
      count += 1;
    }
  }

  return {
    linesRead: points.length,
    practiceDays: days.size,
    bestStreak,
    avgPitch7d: count > 0 ? sum / count : null,
  };
}

// --- inline-style helpers (Signal-Tape vars, since CSS is out of scope) ------

const MONO = 'var(--mono)';

const sx = {
  totals: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    border: '1.5px solid var(--ink)',
    borderRadius: 'var(--r)',
    background: 'var(--paper-2)',
    overflow: 'hidden',
  } as React.CSSProperties,
  totalCell: {
    padding: '16px 18px',
    borderRight: '1px solid var(--line)',
  } as React.CSSProperties,
  totalK: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
  } as React.CSSProperties,
  totalV: {
    fontFamily: 'var(--disp)',
    fontWeight: 900,
    fontSize: 30,
    letterSpacing: '-0.03em',
    marginTop: 4,
    color: 'var(--ink)',
    lineHeight: 1,
  } as React.CSSProperties,
  totalUnit: { color: 'var(--blue)', fontSize: 18 } as React.CSSProperties,
  cols: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: 20,
    alignItems: 'start',
  } as React.CSSProperties,
  panelHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  } as React.CSSProperties,
  deltaUp: { color: 'var(--blue)', fontWeight: 500 } as React.CSSProperties,
  deltaDown: { color: 'var(--flux)', fontWeight: 500 } as React.CSSProperties,
  panelAside: {
    color: 'var(--ink-3)',
    fontWeight: 400,
    letterSpacing: '0.04em',
  } as React.CSSProperties,
  cal: {
    display: 'grid',
    gridTemplateColumns: 'repeat(14, 1fr)',
    gap: 4,
    marginTop: 2,
  } as React.CSSProperties,
  calCell: {
    aspectRatio: '1 / 1',
    borderRadius: 2,
  } as React.CSSProperties,
  calLegend: {
    fontFamily: MONO,
    fontSize: 10,
    color: 'var(--ink-3)',
    marginTop: 12,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  } as React.CSSProperties,
  calLegendSwatch: {
    width: 11,
    height: 11,
    display: 'inline-block',
    borderRadius: 2,
  } as React.CSSProperties,
};

/** Calendar-cell fill for an activity level 0..3 (design .cal .d.l1/l2/l3). */
function calLevelColor(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return '#b9c4f6';
    case 2:
      return '#6f86f0';
    case 3:
      return 'var(--blue)';
    default:
      return 'var(--paper-3)';
  }
}

function TotalsStrip({ points }: { points: AccuracyPoint[] }): React.JSX.Element | null {
  const t = useMemo(() => deriveTotals(points), [points]);
  if (points.length === 0) return null;

  // Each tile is omitted (not fabricated) when its value isn't derivable.
  const tiles: { key: string; label: string; value: React.ReactNode }[] = [
    { key: 'lines', label: 'Lines read', value: t.linesRead },
    { key: 'days', label: 'Practice days', value: t.practiceDays },
  ];
  if (t.bestStreak > 0) {
    tiles.push({
      key: 'streak',
      label: 'Best streak',
      value: (
        <>
          {t.bestStreak} <span style={sx.totalUnit}>days</span>
        </>
      ),
    });
  }
  if (t.avgPitch7d !== null) {
    tiles.push({
      key: 'avgpitch',
      label: 'Avg pitch (7d)',
      value: (
        <>
          {Math.round(t.avgPitch7d * 100)}
          <span style={sx.totalUnit}>%</span>
        </>
      ),
    });
  }

  return (
    <div style={sx.totals} role="group" aria-label="Totals">
      {tiles.map((tile, i) => (
        <div
          style={{
            ...sx.totalCell,
            borderRight: i === tiles.length - 1 ? '0' : '1px solid var(--line)',
          }}
          key={tile.key}
        >
          <div style={sx.totalK}>{tile.label}</div>
          <div style={sx.totalV}>{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

// --- (a) accuracy-over-time chart (Signal Tape trend) -----------------------

const CHART_W = 720;
const CHART_H = 240;
const PAD_L = 44;
const PAD_R = 18;
const PAD_T = 22;
const PAD_B = 28;

function AccuracyChart({ points }: { points: AccuracyPoint[] }): React.JSX.Element {
  if (points.length === 0) {
    return <p className="stats-empty">No first-read attempts match this filter yet.</p>;
  }

  // x = index in the time-ordered series (even spacing reads more clearly than
  // raw wall-clock gaps for a practice log). y = accuracy in [0,1].
  const n = points.length;
  const x = (i: number): number =>
    n === 1 ? PAD_L : PAD_L + (i * (CHART_W - PAD_L - PAD_R)) / (n - 1);
  const y = (v: number): number =>
    CHART_H - PAD_B - v * (CHART_H - PAD_T - PAD_B);

  // Build {index, px, py} for a selector, skipping null gaps.
  const seriesPoints = (
    sel: (p: AccuracyPoint) => number | null,
  ): { i: number; px: number; py: number }[] =>
    points
      .map((p, i) => {
        const v = sel(p);
        return v === null ? null : { i, px: x(i), py: y(v) };
      })
      .filter((s): s is { i: number; px: number; py: number } => s !== null);

  const pathFrom = (pts: { px: number; py: number }[]): string =>
    pts.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.px},${s.py}`).join(' ');

  const pitchPts = seriesPoints((p) => p.pitchAccuracy);
  const timingPts = seriesPoints((p) => p.timingAccuracy);

  // Faint ultramarine area under the pitch line (the "structure/data" fill).
  const baseY = y(0);
  const areaPath =
    pitchPts.length > 0
      ? `M${pitchPts[0].px},${baseY} ` +
        pitchPts.map((s) => `L${s.px},${s.py}`).join(' ') +
        ` L${pitchPts[pitchPts.length - 1].px},${baseY} Z`
      : '';

  // The latest pitch reading is the "live" point → flux marker.
  const latest = pitchPts.length > 0 ? pitchPts[pitchPts.length - 1] : null;
  const latestVal = points[points.length - 1]?.pitchAccuracy ?? null;

  return (
    <div>
      <svg
        className="stats-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        role="img"
        aria-label="Accuracy over time"
      >
        {/* gridlines at 0/25/50/75/100% — hairline, DM-Mono labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              x2={CHART_W - PAD_R}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={8}
              y={y(g) + 3.5}
              fill="var(--ink-3)"
              fontFamily={MONO}
              fontSize={9}
            >
              {Math.round(g * 100)}
            </text>
          </g>
        ))}

        {/* faint ultramarine area + the quiet timing line + the hero pitch line */}
        {areaPath && <path d={areaPath} fill="var(--blue)" opacity={0.08} />}
        <path
          d={pathFrom(timingPts)}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.85}
        />
        <path d={pathFrom(pitchPts)} fill="none" stroke="var(--blue)" strokeWidth={2.5} />

        {/* small ultramarine pitch dots */}
        {pitchPts.map((s) => (
          <circle key={`pp-${s.i}`} cx={s.px} cy={s.py} r={2.5} fill="var(--blue)" />
        ))}

        {/* the latest reading: a flux marker + DM-Mono callout (the live note) */}
        {latest && latestVal !== null && (
          <g>
            <circle cx={latest.px} cy={latest.py} r={4.5} fill="var(--flux)" />
            <text
              x={latest.px - 6}
              y={latest.py - 8}
              textAnchor="end"
              fill="var(--flux)"
              fontFamily={MONO}
              fontSize={10}
            >
              {Math.round(latestVal * 100)}%
            </text>
          </g>
        )}
      </svg>
      <div className="stats-legend">
        <span className="legend-swatch" style={{ background: 'var(--blue)' }} /> pitch
        accuracy
        <span
          className="legend-swatch"
          style={{ background: 'var(--ink-3)', marginLeft: 16 }}
        />{' '}
        timing accuracy
        <span
          className="legend-swatch"
          style={{ background: 'var(--flux)', borderRadius: '50%', marginLeft: 16 }}
        />{' '}
        latest
        <span style={{ marginLeft: 16, color: 'var(--ink-3)' }}>
          ({n} attempt{n === 1 ? '' : 's'})
        </span>
      </div>
    </div>
  );
}

// --- practice calendar (derived from attempt timestamps) --------------------

const CAL_DAYS = 28; // 14×2 grid feel from the design (a 28-day band)

function PracticeCalendar({ points }: { points: AccuracyPoint[] }): React.JSX.Element | null {
  const cells = useMemo(() => {
    if (points.length === 0) return null;
    // count attempts per calendar day
    const perDay = new Map<number, number>();
    for (const p of points) {
      const d = dayIndex(p.startedAt);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const today = dayIndex(Date.now());
    const start = today - (CAL_DAYS - 1);
    const maxCount = Math.max(1, ...perDay.values());
    const out: { day: number; count: number; level: 0 | 1 | 2 | 3; isToday: boolean }[] =
      [];
    for (let d = start; d <= today; d++) {
      const count = perDay.get(d) ?? 0;
      let level: 0 | 1 | 2 | 3 = 0;
      if (count > 0) {
        const r = count / maxCount;
        level = r > 0.66 ? 3 : r > 0.33 ? 2 : 1;
      }
      out.push({ day: d, count, level, isToday: d === today });
    }
    return out;
  }, [points]);

  if (!cells) return null;

  return (
    <div style={sx.cal} role="img" aria-label="Practice calendar (last 28 days)">
      {cells.map((c) => (
        <span
          key={c.day}
          style={{
            ...sx.calCell,
            background: c.isToday && c.count > 0 ? 'var(--flux)' : calLevelColor(c.level),
          }}
          title={
            c.count > 0 ? `${c.count} line${c.count === 1 ? '' : 's'}` : 'no practice'
          }
        />
      ))}
    </div>
  );
}

// --- (b) missed-note staff heatmap ------------------------------------------

/**
 * Heat colour for a miss rate in [0,1] on the design's green→flux scale:
 * clean reads are ultramarine-adjacent green (--ok), often-missed pitches ramp
 * through amber to flux orange (--flux, "drill the orange").
 */
function heatColor(missRate: number): string {
  // anchor stops mirror design/app.html .heat2 cells (green → amber → flux)
  const stops: { at: number; rgb: [number, number, number] }[] = [
    { at: 0, rgb: [31, 143, 91] }, // var(--ok) green — clean
    { at: 0.4, rgb: [122, 154, 78] }, // olive
    { at: 0.6, rgb: [194, 130, 58] }, // var(--warn) amber
    { at: 1, rgb: [255, 91, 31] }, // var(--flux) orange — often missed
  ];
  const t = Math.min(1, Math.max(0, missRate));
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].at && t <= stops[i + 1].at) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const k = (t - lo.at) / span;
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * k);
  const r = mix(lo.rgb[0], hi.rgb[0]);
  const g = mix(lo.rgb[1], hi.rgb[1]);
  const b = mix(lo.rgb[2], hi.rgb[2]);
  return `rgb(${r}, ${g}, ${b})`;
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

  // First-vs-last non-null pitch delta drives the panel's "▲ +N pts" callout —
  // derived from the points already on screen (no new IPC).
  const pitchDelta = useMemo(() => {
    const vals = points
      .map((p) => p.pitchAccuracy)
      .filter((v): v is number => v !== null);
    if (vals.length < 2) return null;
    return Math.round((vals[vals.length - 1] - vals[0]) * 100);
  }, [points]);

  const hasDatedPoints = points.length > 0;

  return (
    <section className="stats-view">
      <header className="stats-header">
        <h2>Progress.</h2>
        <p className="subtitle">
          First-read attempts only (retries excluded from fluency).
        </p>
      </header>

      {!available && (
        <p className="stats-warning">
          Stats are read from the SQLite DB in the Electron main process. Running
          outside Electron (browser preview), so there is no data to show. Launch
          the app with <code>npm run dev</code>.
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

      <TotalsStrip points={points} />

      <div className="stats-cols" style={sx.cols}>
        <div className="stats-panel">
          <h3 style={sx.panelHead}>
            <span>Pitch accuracy over time</span>
            {pitchDelta !== null && (
              <span style={pitchDelta >= 0 ? sx.deltaUp : sx.deltaDown}>
                {pitchDelta >= 0 ? '▲' : '▼'} {pitchDelta >= 0 ? '+' : ''}
                {pitchDelta} pts
              </span>
            )}
          </h3>
          <AccuracyChart points={points} />
        </div>

        {hasDatedPoints && (
          <div className="stats-panel">
            <h3 style={sx.panelHead}>
              <span>Practice calendar</span>
            </h3>
            <PracticeCalendar points={points} />
            <div style={sx.calLegend}>
              less
              <i style={{ ...sx.calLegendSwatch, background: '#b9c4f6' }} />
              <i style={{ ...sx.calLegendSwatch, background: '#6f86f0' }} />
              <i style={{ ...sx.calLegendSwatch, background: 'var(--blue)' }} />
              more · <i style={{ ...sx.calLegendSwatch, background: 'var(--flux)' }} />{' '}
              today
            </div>
          </div>
        )}
      </div>

      <div className="stats-panel">
        <h3 style={sx.panelHead}>
          <span>Weak spots · missed-note heatmap (by pitch)</span>
          <span style={sx.panelAside}>drill the orange</span>
        </h3>
        <MissedNoteHeatmap buckets={buckets} />
      </div>
    </section>
  );
}
