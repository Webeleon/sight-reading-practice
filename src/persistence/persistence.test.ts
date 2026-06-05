// persistence.test.ts — node TDD for the Milestone 5 persistence layer.
//
// Runs under vitest's NODE project (better-sqlite3 is built for the node ABI after
// npm install, so it loads here without electron-rebuild). Every test opens a fresh
// in-memory DB via openInMemory() (the DI seam) and passes it to the DAOs.
//
// Coverage (brief M5 acceptance + the task brief):
//   1. migration applies to a fresh DB; all four tables + their indexes exist.
//   2. writing one completed line -> exactly 1 sessions row, 1 line_attempts row,
//      and N note_events rows (one per expected note) PLUS the extra rows.
//   3. the denormalized dimension columns on line_attempts equal the values parsed
//      out of line_json.
//   4. preset save/load round-trips; usePreset increments use_count + updates
//      last_used_at.

import { describe, it, expect } from 'vitest';
import {
  openInMemory,
  runMigrations,
  insertSession,
  endSession,
  getSession,
  insertLineAttempt,
  getLineAttempt,
  deriveDimensions,
  insertNoteEvents,
  getNoteEvents,
  savePreset,
  loadPreset,
  usePreset,
  listPresets,
  type Db,
} from './index.js';
import { generateLine } from '../generator/index.js';
import type { LineConfig } from '../generator/index.js';
import { serializeLineToMusicXML } from '../musicxml/serialize.js';
import { FOUR_FOUR, makeNeckPosition } from '../domain/index.js';
import type { Line } from '../domain/index.js';
import { evaluateAttempt, type DetectedNote, type ExpectedNote } from '../evaluation/index.js';

// --- shared fixtures --------------------------------------------------------

/** Fixed generation timestamp so generated Lines are fully deterministic (the
 *  generator never reads the clock; generatedAt is injected). */
const GENERATED_AT = '2026-06-05T00:00:00.000Z';

const CONFIG: LineConfig = {
  key: { tonic: { name: 'F', accidental: 'sharp' }, mode: 'minor' },
  timeSignature: FOUR_FOUR,
  position: makeNeckPosition(1, 6, 4, 8, 'V'),
  tempo: 84,
  barCount: 4,
  difficulty: 2,
  accidentalsDensity: 'low',
};

/** Build the ExpectedNote[] for a Line directly from its notes (rests filtered),
 *  on a t=0==first-sounding-note clock. We don't need the count-in offset for the
 *  persistence test — only that expected/detected share a clock — so onsetMs is
 *  derived from startTick at the line's tempo. */
function expectedFromLine(line: Line): ExpectedNote[] {
  const msPerTick = 60000 / line.tempo / 480; // 480 ticks per quarter
  const out: ExpectedNote[] = [];
  for (let i = 0; i < line.notes.length; i++) {
    const n = line.notes[i]!;
    if (n.pitch === null) continue; // rest
    out.push({
      noteIndex: i,
      expectedMidi:
        (n.pitch.octave + 1) * 12 +
        { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n.pitch.name] +
        { doubleFlat: -2, flat: -1, natural: 0, sharp: 1, doubleSharp: 2 }[
          n.pitch.accidental
        ],
      onsetMs: n.startTick * msPerTick,
      durationMs: n.duration.ticks * msPerTick,
    });
  }
  return out;
}

/** A perfect synthetic take: one in-time, correct-pitch detection per expected. */
function perfectTake(expected: ExpectedNote[]): DetectedNote[] {
  return expected.map((e) => ({ midi: e.expectedMidi, onsetMs: e.onsetMs, clarity: 0.95 }));
}

// --- 1. migration -----------------------------------------------------------

describe('migration', () => {
  it('applies to a fresh in-memory DB and creates the four tables', () => {
    const db = openInMemory();
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'sessions',
        'line_attempts',
        'note_events',
        'presets',
      ]),
    );
    db.close();
  });

  it('creates every index named in the schema', () => {
    const db = openInMemory();
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const expected of [
      'idx_sessions_started',
      'idx_attempts_session',
      'idx_attempts_key',
      'idx_attempts_position',
      'idx_attempts_type',
      'idx_attempts_started',
      'idx_events_attempt',
      'idx_events_classification',
      'idx_events_expected_pitch',
      'idx_events_interval',
    ]) {
      expect(indexes).toContain(expected);
    }
    db.close();
  });

  it('is idempotent (running migrations twice is a no-op via user_version)', () => {
    const db = openInMemory();
    const versionBefore = db.pragma('user_version', { simple: true });
    expect(versionBefore).toBe(1);
    // Re-running must not throw "table already exists" — the runner skips applied
    // ones (runMigrations is exported precisely so this is testable).
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });
});

// --- 2/3. writing one completed line ---------------------------------------

describe('writing one completed line', () => {
  function writeCompletedAttempt(db: Db): {
    line: Line;
    sessionId: string;
    attemptId: string;
    expectedCount: number;
    extraCount: number;
  } {
    const line = generateLine(CONFIG, 4242, GENERATED_AT);
    const expected = expectedFromLine(line);
    // Perfect take + 2 spurious extras so we exercise the "extra rows" path.
    const detected = perfectTake(expected);
    const lastOnset = expected.length ? expected[expected.length - 1]!.onsetMs : 0;
    detected.push({ midi: 99, onsetMs: lastOnset + 5000, clarity: 0.9 });
    detected.push({ midi: 98, onsetMs: lastOnset + 6000, clarity: 0.9 });

    const result = evaluateAttempt(expected, detected, {
      tempoBpm: line.tempo,
      subdivision: 'eighth',
    });

    const sessionId = 'sess-1';
    insertSession(db, {
      id: sessionId,
      startedAt: 1000,
      appVersion: 'test-0.0.0',
      configSnapshot: CONFIG,
    });

    const attemptId = 'att-1';
    insertLineAttempt(db, {
      id: attemptId,
      sessionId,
      lineIndexInSession: 0,
      attemptType: 'first_read',
      startedAt: 1100,
      completedAt: 1200,
      durationMs: 100,
      line,
      musicxml: serializeLineToMusicXML(line),
      result,
    });
    insertNoteEvents(db, attemptId, line, result);
    endSession(db, sessionId, 2000);

    return {
      line,
      sessionId,
      attemptId,
      expectedCount: result.totalExpectedNotes,
      extraCount: result.extra,
    };
  }

  it('produces exactly 1 session row, 1 line_attempts row, and N+extra note_events rows', () => {
    const db = openInMemory();
    const { sessionId, attemptId, expectedCount, extraCount } =
      writeCompletedAttempt(db);

    const sessionCount = db
      .prepare(`SELECT COUNT(*) AS c FROM sessions`)
      .get() as { c: number };
    expect(sessionCount.c).toBe(1);

    const attemptCount = db
      .prepare(`SELECT COUNT(*) AS c FROM line_attempts`)
      .get() as { c: number };
    expect(attemptCount.c).toBe(1);

    const eventRows = getNoteEvents(db, attemptId);
    // One row per expected note + one row per extra detection.
    expect(eventRows.length).toBe(expectedCount + extraCount);

    // Exactly `expectedCount` rows have a non-null expected_midi; `extraCount` are
    // 'extra' rows with NULL expected_* fields.
    const withExpected = eventRows.filter((r) => r.expected_midi !== null);
    const extras = eventRows.filter((r) => r.classification === 'extra');
    expect(withExpected.length).toBe(expectedCount);
    expect(extras.length).toBe(extraCount);
    for (const ex of extras) {
      expect(ex.expected_midi).toBeNull();
      expect(ex.expected_pitch_name).toBeNull();
      expect(ex.expected_onset_tick).toBeNull();
      expect(ex.bar_index).toBeNull();
      expect(ex.detected_midi).not.toBeNull();
    }

    // The session/attempt link is intact and ended_at was set.
    expect(getSession(db, sessionId)?.ended_at).toBe(2000);
    db.close();
  });

  it('stores denormalized dimension columns equal to the values inside line_json', () => {
    const db = openInMemory();
    const { line, attemptId } = writeCompletedAttempt(db);

    const row = getLineAttempt(db, attemptId);
    expect(row).toBeDefined();

    // Re-parse the stored line_json and re-derive the dimensions from it: the
    // stored columns must equal that derivation EXACTLY (no drift).
    const parsedLine = JSON.parse(row!['line_json'] as string) as Line;
    const fromJson = deriveDimensions(parsedLine);

    expect(row!['key_tonic']).toBe(fromJson.key_tonic);
    expect(row!['key_mode']).toBe(fromJson.key_mode);
    expect(row!['time_signature']).toBe(fromJson.time_signature);
    expect(row!['position_label']).toBe(fromJson.position_label);
    expect(row!['position_fret_low']).toBe(fromJson.position_fret_low);
    expect(row!['position_fret_high']).toBe(fromJson.position_fret_high);
    expect(row!['bar_count']).toBe(fromJson.bar_count);
    expect(row!['tempo_configured']).toBe(fromJson.tempo_configured);
    expect(row!['phrase_structure']).toBe(fromJson.phrase_structure);
    expect(row!['progression_id']).toBe(fromJson.progression_id);
    expect(row!['rhythmic_motif_id']).toBe(fromJson.rhythmic_motif_id);

    // And those values must match the ORIGINAL in-memory Line too (the source of
    // truth before serialization), proving the round-trip is faithful.
    expect(row!['key_tonic']).toBe('F#');
    expect(row!['key_mode']).toBe('minor');
    expect(row!['time_signature']).toBe('4/4');
    expect(row!['position_label']).toBe('V');
    expect(row!['position_fret_low']).toBe(line.position.fretRange.low);
    expect(row!['position_fret_high']).toBe(line.position.fretRange.high);
    expect(row!['bar_count']).toBe(line.barCount);
    expect(row!['tempo_configured']).toBe(line.tempo);
    expect(row!['phrase_structure']).toBe(line.phraseStructure.pattern);
    expect(row!['progression_id']).toBe(line.progression.progressionId);
    expect(row!['rhythmic_motif_id']).toBe(line.rhythmicMotifPlan.perBarMotifIds[0]);

    // line_id / seed / generator_version mirror the Line too.
    expect(row!['line_id']).toBe(line.id);
    expect(row!['seed']).toBe(line.seed);
    expect(row!['generator_version']).toBe(line.generatorVersion);
    db.close();
  });

  it('null position_label round-trips when the position has no label', () => {
    const db = openInMemory();
    const noLabelConfig: LineConfig = {
      ...CONFIG,
      position: makeNeckPosition(1, 6, 0, 5), // no label
    };
    const line = generateLine(noLabelConfig, 7, GENERATED_AT);
    expect(line.position.label).toBeUndefined();
    insertSession(db, {
      id: 's',
      startedAt: 1,
      appVersion: 'v',
      configSnapshot: noLabelConfig,
    });
    insertLineAttempt(db, {
      id: 'a',
      sessionId: 's',
      lineIndexInSession: 0,
      attemptType: 'first_read',
      startedAt: 1,
      line,
      musicxml: '<x/>',
      totalExpectedNotes: 0,
    });
    const row = getLineAttempt(db, 'a');
    expect(row!['position_label']).toBeNull();
    db.close();
  });

  it('enforces the session FK (better-sqlite3 with foreign_keys ON)', () => {
    const db = openInMemory();
    const line = generateLine(CONFIG, 1, GENERATED_AT);
    expect(() =>
      insertLineAttempt(db, {
        id: 'orphan',
        sessionId: 'does-not-exist',
        lineIndexInSession: 0,
        attemptType: 'first_read',
        startedAt: 1,
        line,
        musicxml: '<x/>',
        totalExpectedNotes: 1,
      }),
    ).toThrow();
    db.close();
  });
});

// --- 4. presets -------------------------------------------------------------

describe('presets', () => {
  it('save/load round-trips the config object', () => {
    const db = openInMemory();
    savePreset(db, { id: 'p1', name: '5th pos jazz', config: CONFIG, now: 500 });

    const loaded = loadPreset<LineConfig>(db, 'p1');
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('5th pos jazz');
    expect(loaded!.config).toEqual(CONFIG);
    expect(loaded!.createdAt).toBe(500);
    expect(loaded!.updatedAt).toBe(500);
    expect(loaded!.lastUsedAt).toBeNull();
    expect(loaded!.useCount).toBe(0);
    db.close();
  });

  it('usePreset increments use_count and updates last_used_at', () => {
    const db = openInMemory();
    savePreset(db, { id: 'p1', name: 'x', config: CONFIG, now: 500 });

    const after1 = usePreset(db, 'p1', 1000);
    expect(after1!.useCount).toBe(1);
    expect(after1!.lastUsedAt).toBe(1000);

    const after2 = usePreset(db, 'p1', 2000);
    expect(after2!.useCount).toBe(2);
    expect(after2!.lastUsedAt).toBe(2000);

    // Persisted, not just returned.
    expect(loadPreset(db, 'p1')!.useCount).toBe(2);
    expect(loadPreset(db, 'p1')!.lastUsedAt).toBe(2000);
    db.close();
  });

  it('usePreset on a missing id returns undefined and does not throw', () => {
    const db = openInMemory();
    expect(usePreset(db, 'nope', 1)).toBeUndefined();
    db.close();
  });

  it('savePreset upserts (re-save updates name/config, preserves use_count + created_at)', () => {
    const db = openInMemory();
    savePreset(db, { id: 'p1', name: 'old', config: CONFIG, now: 100 });
    usePreset(db, 'p1', 150);
    const newConfig: LineConfig = { ...CONFIG, tempo: 120 };
    savePreset(db, { id: 'p1', name: 'new', config: newConfig, now: 200 });

    const loaded = loadPreset<LineConfig>(db, 'p1');
    expect(loaded!.name).toBe('new');
    expect(loaded!.config.tempo).toBe(120);
    expect(loaded!.createdAt).toBe(100); // preserved
    expect(loaded!.updatedAt).toBe(200); // bumped
    expect(loaded!.useCount).toBe(1); // preserved across re-save
    db.close();
  });

  it('listPresets orders most-recently-used first', () => {
    const db = openInMemory();
    savePreset(db, { id: 'a', name: 'A', config: {}, now: 1 });
    savePreset(db, { id: 'b', name: 'B', config: {}, now: 1 });
    usePreset(db, 'b', 100);
    usePreset(db, 'a', 200);
    const ids = listPresets(db).map((p) => p.id);
    expect(ids[0]).toBe('a'); // used last
    db.close();
  });
});
