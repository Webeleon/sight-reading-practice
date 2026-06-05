-- 001_initial.sql — the AUTHORITATIVE persistence schema (brief section 11).
--
-- This file is a FAITHFUL, verbatim copy of the schema in the build brief. It is
-- the single most important transferable artifact of the whole prototype: it goes
-- straight into the future Swift rewrite. DO NOT rename, add, drop, or retype any
-- column, FK, or index relative to the brief. If a schema change is ever needed,
-- add a NEW numbered migration (002_*.sql) — never edit this one.
--
-- Semantics enforced in QUERIES, not the schema (brief section 11):
--   * Only attempt_type = 'first_read' contributes to fluency metrics.
--   * note_events holds one row per EXPECTED note, PLUS extra detected notes that
--     have no expected counterpart (their expected_* columns are NULL).

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  app_version TEXT NOT NULL,
  config_snapshot TEXT NOT NULL
);
CREATE INDEX idx_sessions_started ON sessions(started_at);

CREATE TABLE line_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  line_index_in_session INTEGER NOT NULL,
  attempt_type TEXT NOT NULL,          -- 'first_read'|'retry_at_tempo'|'retry_slower'
  parent_attempt_id TEXT REFERENCES line_attempts(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  line_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  line_json TEXT NOT NULL,
  musicxml TEXT NOT NULL,
  key_tonic TEXT NOT NULL,
  key_mode TEXT NOT NULL,
  time_signature TEXT NOT NULL,
  position_label TEXT,
  position_fret_low INTEGER NOT NULL,
  position_fret_high INTEGER NOT NULL,
  bar_count INTEGER NOT NULL,
  tempo_configured INTEGER NOT NULL,
  phrase_structure TEXT NOT NULL,
  progression_id TEXT NOT NULL,
  rhythmic_motif_id TEXT NOT NULL,
  pitch_accuracy REAL,
  timing_accuracy REAL,
  total_expected_notes INTEGER NOT NULL,
  total_hits INTEGER,
  total_wrong_pitch INTEGER,
  total_late INTEGER,
  total_missed INTEGER,
  total_extra INTEGER
);
CREATE INDEX idx_attempts_session ON line_attempts(session_id);
CREATE INDEX idx_attempts_key ON line_attempts(key_tonic, key_mode);
CREATE INDEX idx_attempts_position ON line_attempts(position_fret_low, position_fret_high);
CREATE INDEX idx_attempts_type ON line_attempts(attempt_type);
CREATE INDEX idx_attempts_started ON line_attempts(started_at);

CREATE TABLE note_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES line_attempts(id),
  note_index INTEGER NOT NULL,
  expected_midi INTEGER,               -- NULL for 'extra' events
  expected_pitch_name TEXT,
  expected_onset_tick INTEGER,
  expected_onset_ms INTEGER,
  expected_duration_ms INTEGER,
  bar_index INTEGER,
  is_strong_beat INTEGER,              -- 0/1
  implied_chord_root TEXT,
  implied_chord_quality TEXT,
  chord_tone_role TEXT,
  interval_from_previous_semitones INTEGER,
  interval_from_previous_size INTEGER,
  interval_from_previous_direction TEXT,
  detected_midi INTEGER,               -- NULL if missed
  detected_onset_ms INTEGER,
  detected_duration_ms INTEGER,
  classification TEXT NOT NULL         -- 'hit'|'wrong_pitch'|'late'|'missed'|'extra'
);
CREATE INDEX idx_events_attempt ON note_events(attempt_id);
CREATE INDEX idx_events_classification ON note_events(classification);
CREATE INDEX idx_events_expected_pitch ON note_events(expected_midi);
CREATE INDEX idx_events_interval ON note_events(interval_from_previous_semitones);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);
