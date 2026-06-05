// stats.ts — the Milestone-5 statistics QUERIES over the persistence schema.
//
// NODE / Electron-main layer (tsconfig.node, no-`any`). These read-only queries
// back the two stats VIEWS (brief Milestone 5 acceptance: "at least two stats
// views ... verify each view's query returns correct numbers against a seeded
// test dataset"). DI: every function takes the Database, so tests pass an
// in-memory DB and the renderer reaches these via IPC (never the SQLite driver
// directly).
//
// THE FLUENCY RULE (brief section 11): only attempt_type = 'first_read' attempts
// contribute to fluency metrics. This is ENFORCED HERE, IN THE QUERIES — not in
// the schema. Every fluency aggregate filters `attempt_type = 'first_read'`, so
// retry_at_tempo / retry_slower rows are excluded from accuracy series and from
// the missed-note heatmap. Retries still LIVE in the tables (the schema stores
// them verbatim); they are simply omitted from these figures.

import type { Db } from './db.js';

/** The fluency attempt_type. Centralised so the filter is impossible to mistype. */
const FIRST_READ: string = 'first_read';

// ----------------------------------------------------------------------------
// (a) accuracyOverTime — pitch & timing accuracy over time, filterable.
// ----------------------------------------------------------------------------

/** Optional dimension filters for {@link accuracyOverTime}. All independent and
 *  ANDed together; omit a field to leave that dimension unconstrained.
 *
 *  Key is matched on the DENORMALIZED key_tonic + key_mode columns (which mirror
 *  line_json — see lineAttempts.deriveDimensions), so enharmonic keys stay
 *  DISTINCT (F# minor != Gb minor). Position is matched on the fret-window
 *  columns (position_fret_low/high), the same dimension idx_attempts_position
 *  indexes. */
export interface AccuracyFilter {
  /** key_tonic, e.g. "C", "F#", "Bb" (the glyph spelling stored on the row). */
  keyTonic?: string;
  /** key_mode, 'major' | 'minor'. */
  keyMode?: string;
  /** Exact position fret-window low bound (position_fret_low). */
  positionFretLow?: number;
  /** Exact position fret-window high bound (position_fret_high). */
  positionFretHigh?: number;
  /** Restrict to one session (session_id). */
  sessionId?: string;
}

/** One point in the accuracy time-series: a single first_read attempt. */
export interface AccuracyPoint {
  /** line_attempts.id. */
  attemptId: string;
  /** started_at (epoch ms) — the series is ordered ascending by this. */
  startedAt: number;
  /** pitch_accuracy in [0,1], or null if the attempt has no metrics. */
  pitchAccuracy: number | null;
  /** timing_accuracy in [0,1], or null if the attempt has no metrics. */
  timingAccuracy: number | null;
  /** Dimensions carried through so a view can label/group points. */
  keyTonic: string;
  keyMode: string;
  positionLabel: string | null;
  positionFretLow: number;
  positionFretHigh: number;
  tempoConfigured: number;
}

/**
 * Pitch & timing accuracy over time for FIRST-READ attempts only (retries are
 * excluded from fluency — brief section 11), in ascending started_at order.
 *
 * `filter` narrows by key (key_tonic + key_mode) and/or position
 * (position_fret_low + position_fret_high) and/or session; every field is
 * optional and ANDed. Attempts without computed metrics (pitch_accuracy NULL,
 * e.g. abandoned) are EXCLUDED so a view never plots a null point.
 */
export function accuracyOverTime(
  db: Db,
  filter: AccuracyFilter = {},
): AccuracyPoint[] {
  const where: string[] = [
    `attempt_type = @firstRead`,
    // Only attempts that actually produced metrics belong in the series.
    `pitch_accuracy IS NOT NULL`,
  ];
  const params: Record<string, string | number> = { firstRead: FIRST_READ };

  if (filter.keyTonic !== undefined) {
    where.push(`key_tonic = @keyTonic`);
    params['keyTonic'] = filter.keyTonic;
  }
  if (filter.keyMode !== undefined) {
    where.push(`key_mode = @keyMode`);
    params['keyMode'] = filter.keyMode;
  }
  if (filter.positionFretLow !== undefined) {
    where.push(`position_fret_low = @positionFretLow`);
    params['positionFretLow'] = filter.positionFretLow;
  }
  if (filter.positionFretHigh !== undefined) {
    where.push(`position_fret_high = @positionFretHigh`);
    params['positionFretHigh'] = filter.positionFretHigh;
  }
  if (filter.sessionId !== undefined) {
    where.push(`session_id = @sessionId`);
    params['sessionId'] = filter.sessionId;
  }

  interface RawRow {
    id: string;
    started_at: number;
    pitch_accuracy: number | null;
    timing_accuracy: number | null;
    key_tonic: string;
    key_mode: string;
    position_label: string | null;
    position_fret_low: number;
    position_fret_high: number;
    tempo_configured: number;
  }

  const rows = db
    .prepare(
      `SELECT id, started_at, pitch_accuracy, timing_accuracy,
              key_tonic, key_mode, position_label,
              position_fret_low, position_fret_high, tempo_configured
         FROM line_attempts
        WHERE ${where.join(' AND ')}
        ORDER BY started_at ASC, id ASC`,
    )
    .all(params) as RawRow[];

  return rows.map((r) => ({
    attemptId: r.id,
    startedAt: r.started_at,
    pitchAccuracy: r.pitch_accuracy,
    timingAccuracy: r.timing_accuracy,
    keyTonic: r.key_tonic,
    keyMode: r.key_mode,
    positionLabel: r.position_label,
    positionFretLow: r.position_fret_low,
    positionFretHigh: r.position_fret_high,
    tempoConfigured: r.tempo_configured,
  }));
}

/** The distinct (key_tonic, key_mode) pairs present among first_read attempts —
 *  drives the key filter dropdown in the view so it only offers keys that have
 *  data. Ordered for stable display. */
export interface KeyOption {
  keyTonic: string;
  keyMode: string;
}

export function availableKeys(db: Db): KeyOption[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT key_tonic, key_mode
         FROM line_attempts
        WHERE attempt_type = @firstRead
        ORDER BY key_tonic ASC, key_mode ASC`,
    )
    .all({ firstRead: FIRST_READ }) as Array<{
    key_tonic: string;
    key_mode: string;
  }>;
  return rows.map((r) => ({ keyTonic: r.key_tonic, keyMode: r.key_mode }));
}

/** The distinct position fret-windows present among first_read attempts — drives
 *  the position filter dropdown. positionLabel is the representative label seen
 *  for that window (may be null). */
export interface PositionOption {
  positionLabel: string | null;
  positionFretLow: number;
  positionFretHigh: number;
}

export function availablePositions(db: Db): PositionOption[] {
  const rows = db
    .prepare(
      `SELECT position_fret_low, position_fret_high, MAX(position_label) AS position_label
         FROM line_attempts
        WHERE attempt_type = @firstRead
        GROUP BY position_fret_low, position_fret_high
        ORDER BY position_fret_low ASC, position_fret_high ASC`,
    )
    .all({ firstRead: FIRST_READ }) as Array<{
    position_fret_low: number;
    position_fret_high: number;
    position_label: string | null;
  }>;
  return rows.map((r) => ({
    positionLabel: r.position_label,
    positionFretLow: r.position_fret_low,
    positionFretHigh: r.position_fret_high,
  }));
}

// ----------------------------------------------------------------------------
// (b) missedNoteHeatmap — per-pitch missed/wrong rate, for a staff heatmap.
// ----------------------------------------------------------------------------

/** Optional scope for {@link missedNoteHeatmap}, mirroring AccuracyFilter so the
 *  heatmap can be narrowed to the same key/position the series is showing. */
export type HeatmapFilter = AccuracyFilter;

/** One aggregated pitch bucket for the staff heatmap. Keyed by expected_midi (the
 *  staff position); expectedPitchName is the representative spelling seen for that
 *  MIDI (enharmonic spellings can collide on one MIDI — we keep the most common). */
export interface PitchHeatmapBucket {
  /** expected_midi — the staff position / heat cell key. */
  expectedMidi: number;
  /** A representative pretty spelling for that MIDI (e.g. "C5"); may be null only
   *  in the degenerate case where no row carried a name. */
  expectedPitchName: string | null;
  /** Total EXPECTED occurrences of this pitch across first_read attempts. */
  total: number;
  /** How many were 'hit'. */
  hits: number;
  /** How many were 'missed' (nothing detected). */
  missed: number;
  /** How many were 'wrong_pitch' (something at the right time, wrong pitch). */
  wrongPitch: number;
  /** How many were 'late' (correct pitch, after the window). */
  late: number;
  /** (missed + wrong_pitch) / total in [0,1] — the heat value: the fraction of
   *  this pitch the player failed to read cleanly (missed or hit a wrong note).
   *  late is NOT counted as a miss here (the pitch was eventually correct). */
  missRate: number;
}

/**
 * Aggregate note_events by expected_midi for FIRST-READ attempts only (retries
 * excluded — brief section 11), suitable for a staff/pitch heatmap. EXTRA events
 * (expected_midi NULL) are excluded — they have no staff position. Buckets are
 * returned in ascending expected_midi order (low pitch to high).
 *
 * The join to line_attempts is what enforces the first_read rule AND lets the
 * heatmap honour the same key/position filter the time-series uses.
 */
export function missedNoteHeatmap(
  db: Db,
  filter: HeatmapFilter = {},
): PitchHeatmapBucket[] {
  const where: string[] = [
    `la.attempt_type = @firstRead`,
    // EXTRA rows have no expected pitch — they have no staff cell.
    `ne.expected_midi IS NOT NULL`,
  ];
  const params: Record<string, string | number> = { firstRead: FIRST_READ };

  if (filter.keyTonic !== undefined) {
    where.push(`la.key_tonic = @keyTonic`);
    params['keyTonic'] = filter.keyTonic;
  }
  if (filter.keyMode !== undefined) {
    where.push(`la.key_mode = @keyMode`);
    params['keyMode'] = filter.keyMode;
  }
  if (filter.positionFretLow !== undefined) {
    where.push(`la.position_fret_low = @positionFretLow`);
    params['positionFretLow'] = filter.positionFretLow;
  }
  if (filter.positionFretHigh !== undefined) {
    where.push(`la.position_fret_high = @positionFretHigh`);
    params['positionFretHigh'] = filter.positionFretHigh;
  }
  if (filter.sessionId !== undefined) {
    where.push(`la.session_id = @sessionId`);
    params['sessionId'] = filter.sessionId;
  }

  interface RawRow {
    expected_midi: number;
    expected_pitch_name: string | null;
    total: number;
    hits: number;
    missed: number;
    wrong_pitch: number;
    late: number;
  }

  // expected_pitch_name: pick the most-common spelling per MIDI. We do this with a
  // correlated subquery rather than MAX() so the displayed name is representative
  // rather than alphabetically-last.
  const rows = db
    .prepare(
      `SELECT
          ne.expected_midi AS expected_midi,
          (SELECT s.expected_pitch_name
             FROM note_events s
             JOIN line_attempts sla ON sla.id = s.attempt_id
            WHERE s.expected_midi = ne.expected_midi
              AND sla.attempt_type = @firstRead
              AND s.expected_pitch_name IS NOT NULL
            GROUP BY s.expected_pitch_name
            ORDER BY COUNT(*) DESC, s.expected_pitch_name ASC
            LIMIT 1) AS expected_pitch_name,
          COUNT(*) AS total,
          SUM(CASE WHEN ne.classification = 'hit' THEN 1 ELSE 0 END) AS hits,
          SUM(CASE WHEN ne.classification = 'missed' THEN 1 ELSE 0 END) AS missed,
          SUM(CASE WHEN ne.classification = 'wrong_pitch' THEN 1 ELSE 0 END) AS wrong_pitch,
          SUM(CASE WHEN ne.classification = 'late' THEN 1 ELSE 0 END) AS late
        FROM note_events ne
        JOIN line_attempts la ON la.id = ne.attempt_id
       WHERE ${where.join(' AND ')}
       GROUP BY ne.expected_midi
       ORDER BY ne.expected_midi ASC`,
    )
    .all(params) as RawRow[];

  return rows.map((r) => ({
    expectedMidi: r.expected_midi,
    expectedPitchName: r.expected_pitch_name,
    total: r.total,
    hits: r.hits,
    missed: r.missed,
    wrongPitch: r.wrong_pitch,
    late: r.late,
    missRate: r.total > 0 ? (r.missed + r.wrong_pitch) / r.total : 0,
  }));
}
