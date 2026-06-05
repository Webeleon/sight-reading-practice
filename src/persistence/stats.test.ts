// stats.test.ts — node TDD for the Milestone-5 stats QUERIES (stats.ts).
//
// Runs under vitest's NODE project (better-sqlite3 is on the node ABI after npm
// install). Each test opens a fresh in-memory DB via openInMemory() (the DI seam)
// and seeds it with hand-built rows whose key/position/classification outcomes are
// KNOWN, then asserts the queries return the exact numbers — including the
// CRITICAL invariant that retry_at_tempo / retry_slower attempts are EXCLUDED from
// every fluency figure (brief section 11).
//
// We INSERT rows directly (not via the generator) so the dataset is fully
// controlled: this isolates the query logic from generator output and lets us
// assert precise accuracy values and per-pitch missed counts.

import { describe, it, expect } from 'vitest';
import { openInMemory } from './db.js';
import type { Db } from './db.js';
import {
  accuracyOverTime,
  availableKeys,
  availablePositions,
  missedNoteHeatmap,
} from './stats.js';

// --- low-level seed helpers (raw SQL so the dataset is exact) ---------------

let attemptSeq = 0;

function seedSession(db: Db, id: string): void {
  db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, app_version, config_snapshot)
     VALUES (@id, 0, NULL, 'test', '{}')`,
  ).run({ id });
}

interface SeedAttempt {
  id?: string;
  sessionId: string;
  attemptType: string;
  startedAt: number;
  pitchAccuracy: number | null;
  timingAccuracy: number | null;
  keyTonic: string;
  keyMode: string;
  positionLabel?: string | null;
  positionFretLow: number;
  positionFretHigh: number;
  tempo?: number;
}

/** Insert one line_attempts row with explicit dimensions + metrics. Returns id. */
function seedAttempt(db: Db, a: SeedAttempt): string {
  const id = a.id ?? `att-${attemptSeq++}`;
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
       @id, @session_id, 0, @attempt_type, NULL,
       @started_at, @started_at, 0,
       @id, 0, 'v', '{}', '<x/>',
       @key_tonic, @key_mode, '4/4',
       @position_label, @position_fret_low, @position_fret_high,
       4, @tempo, 'AAAB', 'prog', 'motif',
       @pitch_accuracy, @timing_accuracy, 0,
       0, 0, 0, 0, 0
     )`,
  ).run({
    id,
    session_id: a.sessionId,
    attempt_type: a.attemptType,
    started_at: a.startedAt,
    key_tonic: a.keyTonic,
    key_mode: a.keyMode,
    position_label: a.positionLabel ?? null,
    position_fret_low: a.positionFretLow,
    position_fret_high: a.positionFretHigh,
    tempo: a.tempo ?? 120,
    pitch_accuracy: a.pitchAccuracy,
    timing_accuracy: a.timingAccuracy,
  });
  return id;
}

/** Insert one expected note_events row with a known classification. */
function seedNote(
  db: Db,
  attemptId: string,
  noteIndex: number,
  expectedMidi: number | null,
  expectedPitchName: string | null,
  classification: string,
): void {
  db.prepare(
    `INSERT INTO note_events (
       attempt_id, note_index, expected_midi, expected_pitch_name,
       expected_onset_tick, expected_onset_ms, expected_duration_ms,
       bar_index, is_strong_beat,
       implied_chord_root, implied_chord_quality, chord_tone_role,
       interval_from_previous_semitones, interval_from_previous_size,
       interval_from_previous_direction,
       detected_midi, detected_onset_ms, detected_duration_ms, classification
     ) VALUES (
       @attempt_id, @note_index, @expected_midi, @expected_pitch_name,
       0, 0, 0, 0, 1, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, @classification
     )`,
  ).run({
    attempt_id: attemptId,
    note_index: noteIndex,
    expected_midi: expectedMidi,
    expected_pitch_name: expectedPitchName,
    classification,
  });
}

// ============================================================================
// (a) accuracyOverTime
// ============================================================================

describe('accuracyOverTime', () => {
  it('returns first_read attempts in ascending started_at order with exact metrics', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    // Inserted out of time order; query must sort ascending by started_at.
    seedAttempt(db, {
      id: 'b',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 200,
      pitchAccuracy: 0.9,
      timingAccuracy: 0.8,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'a',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 100,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.4,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    const series = accuracyOverTime(db);
    expect(series.map((p) => p.attemptId)).toEqual(['a', 'b']);
    expect(series[0]!.pitchAccuracy).toBe(0.5);
    expect(series[0]!.timingAccuracy).toBe(0.4);
    expect(series[1]!.pitchAccuracy).toBe(0.9);
    expect(series[1]!.timingAccuracy).toBe(0.8);
    db.close();
  });

  it('EXCLUDES retry_at_tempo and retry_slower from the fluency series', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'first',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 100,
      pitchAccuracy: 0.6,
      timingAccuracy: 0.6,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'retryT',
      sessionId: 's1',
      attemptType: 'retry_at_tempo',
      startedAt: 150,
      pitchAccuracy: 1.0,
      timingAccuracy: 1.0,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'retryS',
      sessionId: 's1',
      attemptType: 'retry_slower',
      startedAt: 160,
      pitchAccuracy: 1.0,
      timingAccuracy: 1.0,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    const series = accuracyOverTime(db);
    expect(series.map((p) => p.attemptId)).toEqual(['first']);
    db.close();
  });

  it('filters by key (key_tonic + key_mode); enharmonic keys stay distinct', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'cMaj',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.7,
      timingAccuracy: 0.7,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'aMin',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.3,
      timingAccuracy: 0.3,
      keyTonic: 'A',
      keyMode: 'minor',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'fsMin',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 3,
      pitchAccuracy: 0.2,
      timingAccuracy: 0.2,
      keyTonic: 'F#',
      keyMode: 'minor',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'gbMin',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 4,
      pitchAccuracy: 0.1,
      timingAccuracy: 0.1,
      keyTonic: 'Gb',
      keyMode: 'minor',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    expect(
      accuracyOverTime(db, { keyTonic: 'C', keyMode: 'major' }).map(
        (p) => p.attemptId,
      ),
    ).toEqual(['cMaj']);
    // Enharmonic distinctness: F# minor != Gb minor.
    expect(
      accuracyOverTime(db, { keyTonic: 'F#', keyMode: 'minor' }).map(
        (p) => p.attemptId,
      ),
    ).toEqual(['fsMin']);
    expect(
      accuracyOverTime(db, { keyTonic: 'Gb', keyMode: 'minor' }).map(
        (p) => p.attemptId,
      ),
    ).toEqual(['gbMin']);
    db.close();
  });

  it('filters by position (fret window)', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'posV',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.8,
      timingAccuracy: 0.8,
      keyTonic: 'C',
      keyMode: 'major',
      positionLabel: 'V',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'posOpen',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.4,
      timingAccuracy: 0.4,
      keyTonic: 'C',
      keyMode: 'major',
      positionLabel: 'Open',
      positionFretLow: 0,
      positionFretHigh: 4,
    });

    const v = accuracyOverTime(db, {
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    expect(v.map((p) => p.attemptId)).toEqual(['posV']);
    expect(v[0]!.positionLabel).toBe('V');
    db.close();
  });

  it('combines key + position filters (ANDed)', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'match',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.8,
      timingAccuracy: 0.8,
      keyTonic: 'G',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    // Right key, wrong position.
    seedAttempt(db, {
      id: 'wrongPos',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.8,
      timingAccuracy: 0.8,
      keyTonic: 'G',
      keyMode: 'major',
      positionFretLow: 0,
      positionFretHigh: 4,
    });
    // Right position, wrong key.
    seedAttempt(db, {
      id: 'wrongKey',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 3,
      pitchAccuracy: 0.8,
      timingAccuracy: 0.8,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    const r = accuracyOverTime(db, {
      keyTonic: 'G',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    expect(r.map((p) => p.attemptId)).toEqual(['match']);
    db.close();
  });

  it('excludes attempts with null pitch_accuracy (no metrics)', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'abandoned',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: null,
      timingAccuracy: null,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    expect(accuracyOverTime(db)).toEqual([]);
    db.close();
  });
});

// ============================================================================
// availableKeys / availablePositions (filter dropdown helpers)
// ============================================================================

describe('availableKeys / availablePositions', () => {
  it('lists distinct first_read keys and positions only', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    seedAttempt(db, {
      id: 'k1',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionLabel: 'V',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedAttempt(db, {
      id: 'k2',
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionLabel: 'Open',
      positionFretLow: 0,
      positionFretHigh: 4,
    });
    // A retry in a key/position that appears NOWHERE else — must not surface.
    seedAttempt(db, {
      id: 'r',
      sessionId: 's1',
      attemptType: 'retry_slower',
      startedAt: 3,
      pitchAccuracy: 1,
      timingAccuracy: 1,
      keyTonic: 'Eb',
      keyMode: 'minor',
      positionLabel: 'XII',
      positionFretLow: 11,
      positionFretHigh: 15,
    });

    expect(availableKeys(db)).toEqual([{ keyTonic: 'C', keyMode: 'major' }]);
    const positions = availablePositions(db);
    expect(positions).toEqual([
      { positionLabel: 'Open', positionFretLow: 0, positionFretHigh: 4 },
      { positionLabel: 'V', positionFretLow: 4, positionFretHigh: 8 },
    ]);
    db.close();
  });
});

// ============================================================================
// (b) missedNoteHeatmap
// ============================================================================

describe('missedNoteHeatmap', () => {
  it('aggregates per expected_midi with exact missed/wrong/hit counts and missRate', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    const a1 = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    const a2 = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    // MIDI 60 (C4): across both attempts -> 2 hit, 1 missed, 1 wrong_pitch.
    seedNote(db, a1, 0, 60, 'C4', 'hit');
    seedNote(db, a1, 1, 60, 'C4', 'missed');
    seedNote(db, a2, 0, 60, 'C4', 'hit');
    seedNote(db, a2, 1, 60, 'C4', 'wrong_pitch');
    // MIDI 64 (E4): 1 hit, 1 late.
    seedNote(db, a1, 2, 64, 'E4', 'hit');
    seedNote(db, a2, 2, 64, 'E4', 'late');
    // An EXTRA event (expected_midi NULL) must be ignored — no staff cell.
    seedNote(db, a1, 3, null, null, 'extra');

    const heat = missedNoteHeatmap(db);
    expect(heat.map((b) => b.expectedMidi)).toEqual([60, 64]);

    const c4 = heat.find((b) => b.expectedMidi === 60)!;
    expect(c4.total).toBe(4);
    expect(c4.hits).toBe(2);
    expect(c4.missed).toBe(1);
    expect(c4.wrongPitch).toBe(1);
    expect(c4.late).toBe(0);
    // missRate = (missed + wrong_pitch) / total = (1 + 1) / 4 = 0.5
    expect(c4.missRate).toBe(0.5);
    expect(c4.expectedPitchName).toBe('C4');

    const e4 = heat.find((b) => b.expectedMidi === 64)!;
    expect(e4.total).toBe(2);
    expect(e4.hits).toBe(1);
    expect(e4.late).toBe(1);
    expect(e4.missed).toBe(0);
    expect(e4.wrongPitch).toBe(0);
    // late is NOT a miss -> missRate 0.
    expect(e4.missRate).toBe(0);
    db.close();
  });

  it('EXCLUDES retry attempts from the heatmap (fluency rule)', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    const first = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    const retry = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'retry_slower',
      startedAt: 2,
      pitchAccuracy: 1,
      timingAccuracy: 1,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });

    // first_read: 1 missed on MIDI 67. retry: all hits on MIDI 67 (should not count).
    seedNote(db, first, 0, 67, 'G4', 'missed');
    seedNote(db, retry, 0, 67, 'G4', 'hit');
    seedNote(db, retry, 1, 67, 'G4', 'hit');

    const heat = missedNoteHeatmap(db);
    const g4 = heat.find((b) => b.expectedMidi === 67)!;
    // Only the single first_read 'missed' counts.
    expect(g4.total).toBe(1);
    expect(g4.missed).toBe(1);
    expect(g4.hits).toBe(0);
    expect(g4.missRate).toBe(1);
    db.close();
  });

  it('honours the same key/position filter as the time-series', () => {
    const db = openInMemory();
    seedSession(db, 's1');
    const cMaj = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 1,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'C',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    const gMaj = seedAttempt(db, {
      sessionId: 's1',
      attemptType: 'first_read',
      startedAt: 2,
      pitchAccuracy: 0.5,
      timingAccuracy: 0.5,
      keyTonic: 'G',
      keyMode: 'major',
      positionFretLow: 4,
      positionFretHigh: 8,
    });
    seedNote(db, cMaj, 0, 60, 'C4', 'missed');
    seedNote(db, gMaj, 0, 60, 'C4', 'hit');

    const heat = missedNoteHeatmap(db, { keyTonic: 'C', keyMode: 'major' });
    expect(heat).toHaveLength(1);
    expect(heat[0]!.expectedMidi).toBe(60);
    expect(heat[0]!.missed).toBe(1);
    expect(heat[0]!.hits).toBe(0);
    db.close();
  });
});
