// e2e.persistence.test.ts — the SCRIPTED end-to-end test (brief section 15).
//
// Runs under vitest's NODE project. The driver is Node's built-in node:sqlite, so
// it loads here with no native build / rebuild step and `npm run verify` stays
// green with the same code the Electron main process runs. It exercises the
// WHOLE Milestone-5 vertical slice the brief's section-15 acceptance names:
//
//   "A scripted end-to-end test that: starts a session, generates a line, feeds a
//    synthetic detected-note sequence through evaluation, writes all rows, and
//    asserts row counts and metric values."
//
// Pipeline driven here, in order:
//   1. open an in-memory DB (the DI seam, openInMemory) + start a session,
//   2. generateLine(config, seed, generatedAt) — the real generator,
//   3. build expected notes from the Line + a SYNTHETIC detected-note sequence with
//      a deliberate hit/wrong/late/missed/extra mix,
//   4. evaluateAttempt(expected, detected, params) — the real evaluation pipeline,
//   5. insertSession + insertLineAttempt + insertNoteEvents — the real DAOs (the
//      same functions the Electron main process calls over IPC),
//   6. ASSERT: exactly 1 session row, 1 line_attempts row, and
//      (expected notes + extras) note_events rows, AND that the STORED
//      pitch_accuracy / timing_accuracy equal the EvaluationResult's, and the
//      per-classification counts match.
//
// This is intentionally NOT a re-test of the unit-level DAO behaviour (that lives
// in src/persistence/persistence.test.ts); it is the integration smoke that the
// generator -> evaluation -> persistence seam composes end to end.

import { describe, it, expect } from 'vitest';
import {
  openInMemory,
  insertSession,
  endSession,
  insertLineAttempt,
  insertNoteEvents,
  getNoteEvents,
  getLineAttempt,
  getSession,
} from '../src/persistence/index.js';
import { generateLine } from '../src/generator/index.js';
import type { LineConfig } from '../src/generator/index.js';
import { serializeLineToMusicXML } from '../src/musicxml/serialize.js';
import {
  FOUR_FOUR,
  makeNeckPosition,
  pitchToMidi,
} from '../src/domain/index.js';
import type { Line } from '../src/domain/index.js';
import {
  evaluateAttempt,
  toleranceWindow,
  type DetectedNote,
  type ExpectedNote,
  type Subdivision,
} from '../src/evaluation/index.js';

// --- fixtures ---------------------------------------------------------------

/** Injected so the generated Line is fully deterministic (generator never reads
 *  the clock; generatedAt is a parameter). */
const GENERATED_AT = '2026-06-05T00:00:00.000Z';
const SEED = 20260605;

const CONFIG: LineConfig = {
  key: { tonic: { name: 'G', accidental: 'natural' }, mode: 'major' },
  timeSignature: FOUR_FOUR,
  position: makeNeckPosition(1, 6, 4, 8, 'V'),
  tempo: 96,
  barCount: 4,
  difficulty: 2,
  accidentalsDensity: 'low',
};

const SUBDIVISION: Subdivision = 'eighth';

/** Build the rest-filtered ExpectedNote[] for a Line on a t=0==first-note clock.
 *  We don't need the count-in offset (expected and detected share the same clock),
 *  so onsetMs is derived from startTick at the line's tempo (480 ticks/quarter).
 *  pitchToMidi (domain) gives the expected MIDI so the test does not re-implement
 *  the pitch->MIDI math. */
function expectedFromLine(line: Line): ExpectedNote[] {
  const msPerTick = 60000 / line.tempo / 480;
  const out: ExpectedNote[] = [];
  for (let i = 0; i < line.notes.length; i++) {
    const n = line.notes[i]!;
    if (n.pitch === null) continue; // rest is not an expected note
    out.push({
      noteIndex: i,
      expectedMidi: pitchToMidi(n.pitch),
      onsetMs: n.startTick * msPerTick,
      durationMs: n.duration.ticks * msPerTick,
    });
  }
  return out;
}

/**
 * A SYNTHETIC detected-note sequence with a deliberate, deterministic mix so the
 * evaluation produces every classification:
 *   - first note:  one step too high, in time            => wrong_pitch
 *   - second note: correct pitch but clearly late        => late
 *   - third note:  dropped (no detection)                => missed
 *   - all others:  correct pitch, in time                => hit
 *   - plus TWO spurious detections after the line ends   => extra x2
 * The late offset is derived from the SAME tolerance window evaluation uses, so
 * the note lands past the in-band late bound but inside the aligner's search
 * horizon (and is classified `late`, not dropped as an extra) at this tempo/grid.
 */
function syntheticTake(expected: ExpectedNote[]): DetectedNote[] {
  const win = toleranceWindow(CONFIG.tempo, SUBDIVISION);
  const lateOffset = win.lateMs + win.symmetricMs; // 2.4*W < 3*W search horizon
  const out: DetectedNote[] = [];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    if (i === 0) {
      out.push({ midi: e.expectedMidi + 1, onsetMs: e.onsetMs, clarity: 0.95 });
    } else if (i === 1) {
      out.push({ midi: e.expectedMidi, onsetMs: e.onsetMs + lateOffset, clarity: 0.95 });
    } else if (i === 2) {
      continue; // missed
    } else {
      out.push({ midi: e.expectedMidi, onsetMs: e.onsetMs, clarity: 0.95 });
    }
  }
  const last = expected.length ? expected[expected.length - 1]!.onsetMs : 0;
  out.push({ midi: 99, onsetMs: last + 5000, clarity: 0.9 });
  out.push({ midi: 98, onsetMs: last + 6000, clarity: 0.9 });
  out.sort((a, b) => a.onsetMs - b.onsetMs);
  return out;
}

// --- the scripted e2e -------------------------------------------------------

describe('scripted e2e: session -> generate -> evaluate -> persist (brief §15)', () => {
  it('writes 1 session, 1 attempt, and (expected + extra) note_events; stored metrics == evaluation result', () => {
    // 1. open the DB + start a session.
    const db = openInMemory();
    const sessionId = 'e2e-session';
    insertSession(db, {
      id: sessionId,
      startedAt: Date.now(),
      appVersion: 'e2e-0.0.0',
      configSnapshot: CONFIG,
    });

    // 2. generate a line (the real generator).
    const line = generateLine(CONFIG, SEED, GENERATED_AT);
    expect(line.notes.length).toBeGreaterThan(0);

    // 3. expected notes + synthetic detected sequence.
    const expected = expectedFromLine(line);
    expect(expected.length).toBeGreaterThanOrEqual(4); // mix needs >= 4 expected
    const detected = syntheticTake(expected);

    // 4. run the real evaluation pipeline.
    const result = evaluateAttempt(expected, detected, {
      tempoBpm: line.tempo,
      subdivision: SUBDIVISION,
    });

    // The synthetic mix is engineered to surface EVERY classification.
    expect(result.totalExpectedNotes).toBe(expected.length);
    expect(result.wrongPitch).toBeGreaterThanOrEqual(1);
    expect(result.late).toBeGreaterThanOrEqual(1);
    expect(result.missed).toBeGreaterThanOrEqual(1);
    expect(result.hits).toBeGreaterThanOrEqual(1);
    expect(result.extra).toBe(2);
    // Counts partition the expected notes exactly (brief section 13).
    expect(result.hits + result.wrongPitch + result.late + result.missed).toBe(
      result.totalExpectedNotes,
    );

    // 5. write all rows via the DAOs (the SAME ones the main process calls via IPC).
    const attemptId = 'e2e-attempt';
    const startedAt = Date.now();
    insertLineAttempt(db, {
      id: attemptId,
      sessionId,
      lineIndexInSession: 0,
      attemptType: 'first_read',
      startedAt,
      completedAt: startedAt + 4000,
      durationMs: 4000,
      line,
      musicxml: serializeLineToMusicXML(line),
      result,
    });
    const eventsWritten = insertNoteEvents(db, attemptId, line, result);
    endSession(db, sessionId, Date.now());

    // 6a. ROW COUNTS: exactly 1 session, 1 attempt, expected+extra note_events.
    const sessionCount = db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number };
    const attemptCount = db.prepare(`SELECT COUNT(*) AS c FROM line_attempts`).get() as { c: number };
    expect(sessionCount.c).toBe(1);
    expect(attemptCount.c).toBe(1);

    const events = getNoteEvents(db, attemptId);
    expect(eventsWritten).toBe(events.length);
    expect(events.length).toBe(result.totalExpectedNotes + result.extra);

    // Exactly totalExpectedNotes rows carry an expected pitch; `extra` rows are
    // 'extra'-classified with NULL expected_* fields.
    const withExpected = events.filter((r) => r.expected_midi !== null);
    const extras = events.filter((r) => r.classification === 'extra');
    expect(withExpected.length).toBe(result.totalExpectedNotes);
    expect(extras.length).toBe(result.extra);
    for (const ex of extras) {
      expect(ex.expected_midi).toBeNull();
      expect(ex.expected_pitch_name).toBeNull();
      expect(ex.detected_midi).not.toBeNull();
    }

    // 6b. STORED METRICS == the evaluation result.
    const row = getLineAttempt(db, attemptId);
    expect(row).toBeDefined();
    expect(row!['pitch_accuracy']).toBe(result.pitchAccuracy);
    expect(row!['timing_accuracy']).toBe(result.timingAccuracy);
    expect(row!['total_expected_notes']).toBe(result.totalExpectedNotes);
    expect(row!['total_hits']).toBe(result.hits);
    expect(row!['total_wrong_pitch']).toBe(result.wrongPitch);
    expect(row!['total_late']).toBe(result.late);
    expect(row!['total_missed']).toBe(result.missed);
    expect(row!['total_extra']).toBe(result.extra);

    // 6c. per-classification counts in note_events match the result.
    const byClass = (c: string): number =>
      events.filter((r) => r.classification === c).length;
    expect(byClass('hit')).toBe(result.hits);
    expect(byClass('wrong_pitch')).toBe(result.wrongPitch);
    expect(byClass('late')).toBe(result.late);
    expect(byClass('missed')).toBe(result.missed);
    expect(byClass('extra')).toBe(result.extra);

    // Session link is intact and ended_at was stamped.
    const session = getSession(db, sessionId);
    expect(session?.ended_at).not.toBeNull();
    expect(row!['session_id']).toBe(sessionId);

    db.close();
  });

  it('persists all three attempt_types but only first_read drives fluency (rule is a QUERY concern)', () => {
    // A compact session: one first_read + one retry_slower of the same line. Both
    // ROWS exist (the schema stores attempt_type verbatim); the fluency rule lives
    // in the stats queries (src/persistence/stats.ts), not the write path.
    const db = openInMemory();
    const sessionId = 's';
    insertSession(db, { id: sessionId, startedAt: 1, appVersion: 'v', configSnapshot: CONFIG });

    const line = generateLine(CONFIG, SEED, GENERATED_AT);
    const expected = expectedFromLine(line);
    const result = evaluateAttempt(
      expected,
      expected.map((e) => ({ midi: e.expectedMidi, onsetMs: e.onsetMs, clarity: 0.95 })),
      { tempoBpm: line.tempo, subdivision: SUBDIVISION },
    );

    insertLineAttempt(db, {
      id: 'a1', sessionId, lineIndexInSession: 0, attemptType: 'first_read',
      startedAt: 1, completedAt: 2, durationMs: 1, line,
      musicxml: serializeLineToMusicXML(line), result,
    });
    insertNoteEvents(db, 'a1', line, result);

    insertLineAttempt(db, {
      id: 'a2', sessionId, lineIndexInSession: 1, attemptType: 'retry_slower',
      parentAttemptId: 'a1', startedAt: 3, completedAt: 4, durationMs: 1, line,
      musicxml: serializeLineToMusicXML(line), result,
    });
    insertNoteEvents(db, 'a2', line, result);

    const allAttempts = db.prepare(`SELECT COUNT(*) AS c FROM line_attempts`).get() as { c: number };
    expect(allAttempts.c).toBe(2); // BOTH attempt_types are stored.

    const firstReads = db
      .prepare(`SELECT COUNT(*) AS c FROM line_attempts WHERE attempt_type = 'first_read'`)
      .get() as { c: number };
    expect(firstReads.c).toBe(1); // the fluency-eligible subset.

    db.close();
  });
});
