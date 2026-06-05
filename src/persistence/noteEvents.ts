// noteEvents.ts — DAO for the `note_events` table (brief section 11).
//
// One row per EXPECTED note, PLUS one row per EXTRA detected note (those have NULL
// expected_* fields, per the schema's nullable expected_* columns). The per-note
// EXPECTED dimension fields (bar_index, is_strong_beat, implied_chord_*,
// chord_tone_role, interval_from_previous_*, expected_onset_tick,
// expected_pitch_name) are derived from the Line (joined by noteIndex). The
// detected / classification fields come from the EvaluationResult's per-note rows.
//
// The EvaluationResult.notes array already has exactly one NoteResult per expected
// note (in expected order, noteIndex set) followed by the extra rows (noteIndex
// null, classification 'extra'), so iterating it produces precisely the row set
// the schema describes. note_index for an EXTRA row is its ordinal among extras.
//
// No `any` (brief section 16).

import type { Db } from './db.js';
import type { Line, LineNote, Pitch } from '../domain/index.js';
import { pitchToMidi, prettyPitch, intervalBetween } from '../domain/index.js';
import type { EvaluationResult, NoteResult } from '../evaluation/index.js';

/** Signed-semitone + diatonic size + direction of the interval from the previous
 *  SOUNDING note (null across rests / at the first note). Computed from domain
 *  primitives so persistence does not depend on the generator. */
interface IntervalParts {
  semitones: number | null;
  size: number | null;
  direction: string | null;
}

function intervalFromPrevious(line: Line, noteIndex: number): IntervalParts {
  const none: IntervalParts = { semitones: null, size: null, direction: null };
  if (noteIndex <= 0) return none;
  const cur = line.notes[noteIndex]?.pitch ?? null;
  const prev = line.notes[noteIndex - 1]?.pitch ?? null;
  if (cur === null || prev === null) return none;
  const iv = intervalBetween(prev, cur);
  return {
    // Signed semitone delta (positive = ascending), matching the generator's
    // intervalFromPrevious convention.
    semitones: pitchToMidi(cur) - pitchToMidi(prev),
    size: iv.size,
    direction: iv.direction,
  };
}

/** The fully-resolved column bag for one note_events row. */
interface NoteEventRow {
  attempt_id: string;
  note_index: number;
  expected_midi: number | null;
  expected_pitch_name: string | null;
  expected_onset_tick: number | null;
  expected_onset_ms: number | null;
  expected_duration_ms: number | null;
  bar_index: number | null;
  is_strong_beat: number | null;
  implied_chord_root: string | null;
  implied_chord_quality: string | null;
  chord_tone_role: string | null;
  interval_from_previous_semitones: number | null;
  interval_from_previous_size: number | null;
  interval_from_previous_direction: string | null;
  detected_midi: number | null;
  detected_onset_ms: number | null;
  detected_duration_ms: number | null;
  classification: string;
}

/** Round a possibly-fractional ms value to an INTEGER (the column type) or null. */
function msOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

/** Build the EXPECTED-side columns for a real note from the Line. */
function expectedColumnsFor(
  line: Line,
  noteIndex: number,
  row: NoteResult,
): Pick<
  NoteEventRow,
  | 'expected_midi'
  | 'expected_pitch_name'
  | 'expected_onset_tick'
  | 'expected_onset_ms'
  | 'expected_duration_ms'
  | 'bar_index'
  | 'is_strong_beat'
  | 'implied_chord_root'
  | 'implied_chord_quality'
  | 'chord_tone_role'
  | 'interval_from_previous_semitones'
  | 'interval_from_previous_size'
  | 'interval_from_previous_direction'
> {
  const note: LineNote | undefined = line.notes[noteIndex];
  const pitch: Pitch | null = note?.pitch ?? null;
  const iv = intervalFromPrevious(line, noteIndex);
  return {
    expected_midi: row.expectedMidi,
    expected_pitch_name: pitch ? prettyPitch(pitch) : null,
    expected_onset_tick: note ? note.startTick : null,
    expected_onset_ms: msOrNull(row.expectedOnsetMs),
    expected_duration_ms: msOrNull(row.expectedDurationMs),
    bar_index: note ? note.barIndex : null,
    is_strong_beat: note ? (note.isStrongBeat ? 1 : 0) : null,
    implied_chord_root: note ? prettyPitch(note.impliedChord.root) : null,
    implied_chord_quality: note ? note.impliedChord.quality : null,
    chord_tone_role: note ? note.chordToneRole : null,
    interval_from_previous_semitones: iv.semitones,
    interval_from_previous_size: iv.size,
    interval_from_previous_direction: iv.direction,
  };
}

/** Insert all note_events rows for one attempt: one per expected note (joined to
 *  the Line by noteIndex) plus one per extra detection (NULL expected_* fields).
 *  Returns the number of rows inserted. */
export function insertNoteEvents(
  db: Db,
  attemptId: string,
  line: Line,
  result: EvaluationResult,
): number {
  const stmt = db.prepare(
    `INSERT INTO note_events (
       attempt_id, note_index,
       expected_midi, expected_pitch_name, expected_onset_tick,
       expected_onset_ms, expected_duration_ms,
       bar_index, is_strong_beat,
       implied_chord_root, implied_chord_quality, chord_tone_role,
       interval_from_previous_semitones, interval_from_previous_size,
       interval_from_previous_direction,
       detected_midi, detected_onset_ms, detected_duration_ms,
       classification
     ) VALUES (
       @attempt_id, @note_index,
       @expected_midi, @expected_pitch_name, @expected_onset_tick,
       @expected_onset_ms, @expected_duration_ms,
       @bar_index, @is_strong_beat,
       @implied_chord_root, @implied_chord_quality, @chord_tone_role,
       @interval_from_previous_semitones, @interval_from_previous_size,
       @interval_from_previous_direction,
       @detected_midi, @detected_onset_ms, @detected_duration_ms,
       @classification
     )`,
  );

  let extraOrdinal = 0;
  let count = 0;

  const insertAll = db.transaction((): void => {
    for (const r of result.notes) {
      const isExtra = r.noteIndex === null;
      // note_index: the Line note index for real notes; the extra's ordinal for
      // extras (so extras get a stable, increasing index distinct per attempt).
      const noteIndex = isExtra ? extraOrdinal++ : r.noteIndex!;

      const expected = isExtra
        ? {
            // EXTRA: every expected_* field is NULL (schema requirement).
            expected_midi: null,
            expected_pitch_name: null,
            expected_onset_tick: null,
            expected_onset_ms: null,
            expected_duration_ms: null,
            bar_index: null,
            is_strong_beat: null,
            implied_chord_root: null,
            implied_chord_quality: null,
            chord_tone_role: null,
            interval_from_previous_semitones: null,
            interval_from_previous_size: null,
            interval_from_previous_direction: null,
          }
        : expectedColumnsFor(line, r.noteIndex!, r);

      const rowData: NoteEventRow = {
        attempt_id: attemptId,
        note_index: noteIndex,
        ...expected,
        detected_midi: r.detectedMidi,
        detected_onset_ms: msOrNull(r.detectedOnsetMs),
        detected_duration_ms: msOrNull(r.detectedDurationMs),
        classification: r.classification,
      };
      stmt.run(rowData);
      count++;
    }
  });
  insertAll();

  console.log(
    `[DB] inserted ${count} note_events for attempt ${attemptId} ` +
      `(expected=${result.totalExpectedNotes} extra=${result.extra})`,
  );
  return count;
}

/** Fetch all note_events rows for an attempt, ordered by id (insertion order). */
export function getNoteEvents(
  db: Db,
  attemptId: string,
): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT * FROM note_events WHERE attempt_id = @attempt_id ORDER BY id`,
    )
    .all({ attempt_id: attemptId }) as Array<Record<string, unknown>>;
}
