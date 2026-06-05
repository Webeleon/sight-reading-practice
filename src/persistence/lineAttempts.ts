// lineAttempts.ts — DAO for the `line_attempts` table (brief section 11).
//
// One row per completed attempt. CRITICAL: the denormalized DIMENSION columns
// (key_tonic, key_mode, time_signature, position_*, bar_count, tempo_configured,
// phrase_structure, progression_id, rhythmic_motif_id, ...) MUST match the values
// inside line_json — they are a flattened projection of the Line, stored alongside
// the full JSON so stats queries can GROUP BY / filter without parsing JSON. We
// derive them HERE from the Line so they can never drift from line_json.
//
// attempt_type is stored verbatim ('first_read'|'retry_at_tempo'|'retry_slower');
// the "only first_read counts toward fluency" rule is a QUERY concern (stats.ts),
// NOT a schema concern (brief section 11).
//
// No `any` (brief section 16).

import type { Db } from './db.js';
import type { Line } from '../domain/index.js';
import type { EvaluationResult } from '../evaluation/index.js';

/** attempt_type values (brief sections 11/13). */
export type AttemptType = 'first_read' | 'retry_at_tempo' | 'retry_slower';

/** Pretty-prints a key tonic spelling, e.g. {name:'F',accidental:'sharp'} -> "F#".
 *  Matches the spelling used elsewhere (prettyPitch glyphs) so key_tonic is stable
 *  and enharmonic keys stay DISTINCT (F# vs Gb). */
function tonicLabel(line: Line): string {
  const glyph: Record<Line['key']['tonic']['accidental'], string> = {
    natural: '',
    sharp: '#',
    flat: 'b',
    doubleSharp: 'x',
    doubleFlat: 'bb',
  };
  return `${line.key.tonic.name}${glyph[line.key.tonic.accidental]}`;
}

/** "beats/beatUnit", e.g. "4/4", from the line's time signature. */
function timeSignatureLabel(line: Line): string {
  return `${line.timeSignature.beats}/${line.timeSignature.beatUnit}`;
}

/** The representative rhythmic motif id for the attempt. The plan assigns one
 *  motif per bar (perBarMotifIds); we store the FIRST bar's motif as the single
 *  dimension value the schema asks for (rhythmic_motif_id is one column). */
function rhythmicMotifId(line: Line): string {
  return line.rhythmicMotifPlan.perBarMotifIds[0] ?? '';
}

/** The denormalized dimension columns, derived purely from the Line. Exported so
 *  tests can assert these equal the values parsed back out of line_json. */
export interface AttemptDimensions {
  key_tonic: string;
  key_mode: string;
  time_signature: string;
  position_label: string | null;
  position_fret_low: number;
  position_fret_high: number;
  bar_count: number;
  tempo_configured: number;
  phrase_structure: string;
  progression_id: string;
  rhythmic_motif_id: string;
}

/** Project a Line into the flat dimension columns stored on line_attempts. */
export function deriveDimensions(line: Line): AttemptDimensions {
  return {
    key_tonic: tonicLabel(line),
    key_mode: line.key.mode,
    time_signature: timeSignatureLabel(line),
    position_label: line.position.label ?? null,
    position_fret_low: line.position.fretRange.low,
    position_fret_high: line.position.fretRange.high,
    bar_count: line.barCount,
    tempo_configured: line.tempo,
    phrase_structure: line.phraseStructure.pattern,
    progression_id: line.progression.progressionId,
    rhythmic_motif_id: rhythmicMotifId(line),
  };
}

/** Everything needed to insert one completed attempt. The dimension columns are
 *  NOT passed in — they are derived from `line` so they cannot drift from
 *  line_json. `result` may be null for an abandoned/incomplete attempt (the
 *  metric + count columns are nullable except total_expected_notes). */
export interface InsertAttemptArgs {
  id: string;
  sessionId: string;
  lineIndexInSession: number;
  attemptType: AttemptType;
  /** id of the attempt this is a retry of, if any (parent_attempt_id FK). */
  parentAttemptId?: string | null;
  startedAt: number;
  completedAt?: number | null;
  durationMs?: number | null;
  line: Line;
  musicxml: string;
  /** The evaluation outcome; null if the attempt did not complete. When provided,
   *  total_expected_notes comes from it; otherwise pass totalExpectedNotes. */
  result?: EvaluationResult | null;
  /** Expected-note count when `result` is absent (schema requires it NOT NULL). */
  totalExpectedNotes?: number;
}

/** Insert one line_attempts row with all dimension columns derived from the Line.
 *  Returns the attempt id. */
export function insertLineAttempt(db: Db, args: InsertAttemptArgs): string {
  const dims = deriveDimensions(args.line);
  const r = args.result ?? null;

  const totalExpected =
    r?.totalExpectedNotes ?? args.totalExpectedNotes ?? null;
  if (totalExpected === null) {
    throw new Error(
      '[DB] insertLineAttempt: total_expected_notes is NOT NULL — pass `result` or `totalExpectedNotes`',
    );
  }

  db.prepare(
    `INSERT INTO line_attempts (
       id, session_id, line_index_in_session, attempt_type, parent_attempt_id,
       started_at, completed_at, duration_ms,
       line_id, seed, generator_version, line_json, musicxml,
       key_tonic, key_mode, time_signature,
       position_label, position_fret_low, position_fret_high,
       bar_count, tempo_configured, phrase_structure, progression_id, rhythmic_motif_id,
       pitch_accuracy, timing_accuracy, total_expected_notes,
       total_hits, total_wrong_pitch, total_late, total_missed, total_extra
     ) VALUES (
       @id, @session_id, @line_index_in_session, @attempt_type, @parent_attempt_id,
       @started_at, @completed_at, @duration_ms,
       @line_id, @seed, @generator_version, @line_json, @musicxml,
       @key_tonic, @key_mode, @time_signature,
       @position_label, @position_fret_low, @position_fret_high,
       @bar_count, @tempo_configured, @phrase_structure, @progression_id, @rhythmic_motif_id,
       @pitch_accuracy, @timing_accuracy, @total_expected_notes,
       @total_hits, @total_wrong_pitch, @total_late, @total_missed, @total_extra
     )`,
  ).run({
    id: args.id,
    session_id: args.sessionId,
    line_index_in_session: args.lineIndexInSession,
    attempt_type: args.attemptType,
    parent_attempt_id: args.parentAttemptId ?? null,
    started_at: args.startedAt,
    completed_at: args.completedAt ?? null,
    duration_ms: args.durationMs ?? null,
    line_id: args.line.id,
    seed: args.line.seed,
    generator_version: args.line.generatorVersion,
    line_json: JSON.stringify(args.line),
    musicxml: args.musicxml,
    key_tonic: dims.key_tonic,
    key_mode: dims.key_mode,
    time_signature: dims.time_signature,
    position_label: dims.position_label,
    position_fret_low: dims.position_fret_low,
    position_fret_high: dims.position_fret_high,
    bar_count: dims.bar_count,
    tempo_configured: dims.tempo_configured,
    phrase_structure: dims.phrase_structure,
    progression_id: dims.progression_id,
    rhythmic_motif_id: dims.rhythmic_motif_id,
    pitch_accuracy: r ? r.pitchAccuracy : null,
    timing_accuracy: r ? r.timingAccuracy : null,
    total_expected_notes: totalExpected,
    total_hits: r ? r.hits : null,
    total_wrong_pitch: r ? r.wrongPitch : null,
    total_late: r ? r.late : null,
    total_missed: r ? r.missed : null,
    total_extra: r ? r.extra : null,
  });
  console.log(
    `[DB] inserted line_attempt ${args.id} (type=${args.attemptType} ` +
      `key=${dims.key_tonic} ${dims.key_mode} expected=${totalExpected})`,
  );
  return args.id;
}

/** Fetch one attempt row (untyped column bag — callers narrow as needed). */
export function getLineAttempt(
  db: Db,
  id: string,
): Record<string, unknown> | undefined {
  return db.prepare(`SELECT * FROM line_attempts WHERE id = @id`).get({ id }) as
    | Record<string, unknown>
    | undefined;
}
