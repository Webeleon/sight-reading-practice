// sessionBridge.ts — renderer-side typed accessor for the session-loop WRITE IPC
// (Milestone 5). Mirrors statsBridge.ts.
//
// Disposable UI layer. The renderer NEVER imports the persistence layer or
// better-sqlite3 (native, main-process only). It calls the preload bridge
// (window.sightReading.session / .presets), which round-trips to the
// main-process DB. Every function DEGRADES GRACEFULLY outside Electron (the
// `npm run dev` browser preview, where there is no main process / DB): it returns
// { persisted: false } / null / [] instead of throwing, so the read-along loop
// runs identically with or without persistence.
//
// The Line + EvaluationResult are passed straight through as plain JSON (both are
// JSON.stringify-round-trip-safe by design — domain/line.ts). The MAIN process
// derives the denormalized line_attempts dimension columns from the Line and
// writes the note_events, so the renderer never duplicates that logic.

import './appConfig.js'; // ensures Window.sightReading is declared once
import type { Line } from '../domain/index.js';
import type { EvaluationResult } from '../evaluation/index.js';
import { serializeLineToMusicXML } from '../musicxml/serialize.js';
import type { AttemptType } from './useSightReading.js';

/** Whether a write hit the DB (false = persistence disabled / browser preview). */
export interface PersistAck {
  persisted: boolean;
}

/** Everything the renderer knows about one completed attempt; we assemble the IPC
 *  payload (incl. the serialized MusicXML) from this. */
export interface CompletedAttempt {
  /** The session this attempt belongs to. */
  sessionId: string;
  /** 0-based ordinal of this attempt within the session. */
  lineIndexInSession: number;
  attemptType: AttemptType;
  /** parent_attempt_id for a retry, if known. */
  parentAttemptId?: string | null;
  /** epoch ms when the attempt's musical time began (count-in end). */
  startedAt: number;
  /** epoch ms when the attempt finished. */
  completedAt: number;
  /** The line that was read. */
  line: Line;
  /** The evaluation outcome (drives the metric + count columns + note_events). */
  result: EvaluationResult;
}

interface SessionBridge {
  start: (payload: { id: string; configSnapshot: unknown }) => Promise<PersistAck>;
  end: (id: string) => Promise<PersistAck>;
  writeAttempt: (payload: {
    id: string;
    sessionId: string;
    lineIndexInSession: number;
    attemptType: AttemptType;
    parentAttemptId?: string | null;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    line: Line;
    musicxml: string;
    result: EvaluationResult;
  }) => Promise<PersistAck>;
}

interface PresetsBridge {
  save: (payload: { id: string; name: string; config: unknown }) => Promise<PersistAck>;
  load: (id: string) => Promise<unknown | null>;
  list: () => Promise<unknown[]>;
  use: (id: string) => Promise<unknown | null>;
  remove: (id: string) => Promise<{ deleted: boolean }>;
}

function session(): SessionBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const sr = window.sightReading as
    | (Window['sightReading'] & { session?: SessionBridge })
    | undefined;
  return sr?.session;
}

function presets(): PresetsBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const sr = window.sightReading as
    | (Window['sightReading'] & { presets?: PresetsBridge })
    | undefined;
  return sr?.presets;
}

/** Whether the session WRITE IPC surface is present (i.e. running in Electron). */
export function persistenceAvailable(): boolean {
  return session() !== undefined;
}

/** Generate a fresh id for a session / attempt. crypto.randomUUID is available in
 *  the renderer (DOM context); falls back to a timestamp+random string elsewhere. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Start a session (one sessions row). No-op (false) outside Electron. */
export async function startSession(
  id: string,
  configSnapshot: unknown,
): Promise<PersistAck> {
  const b = session();
  if (!b) return { persisted: false };
  return b.start({ id, configSnapshot });
}

/** End a session (stamp ended_at). No-op outside Electron. */
export async function endSession(id: string): Promise<PersistAck> {
  const b = session();
  if (!b) return { persisted: false };
  return b.end(id);
}

/**
 * Persist one COMPLETED attempt + its note_events. Serializes the Line to
 * MusicXML here (the schema's `musicxml` column) and computes duration_ms; the
 * MAIN process derives the denormalized dimension columns from the Line and
 * writes the per-note rows. No-op (false) outside Electron.
 */
export async function writeCompletedAttempt(
  attempt: CompletedAttempt,
): Promise<PersistAck> {
  const b = session();
  if (!b) return { persisted: false };
  const id = newId();
  return b.writeAttempt({
    id,
    sessionId: attempt.sessionId,
    lineIndexInSession: attempt.lineIndexInSession,
    attemptType: attempt.attemptType,
    parentAttemptId: attempt.parentAttemptId ?? null,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    durationMs: Math.max(0, attempt.completedAt - attempt.startedAt),
    line: attempt.line,
    musicxml: serializeLineToMusicXML(attempt.line),
    result: attempt.result,
  });
}

/** Save a named preset config. No-op outside Electron. */
export async function savePreset(
  id: string,
  name: string,
  config: unknown,
): Promise<PersistAck> {
  const b = presets();
  if (!b) return { persisted: false };
  return b.save({ id, name, config });
}

/** Load one preset by id (null if missing / persistence off). */
export async function loadPreset(id: string): Promise<unknown | null> {
  const b = presets();
  if (!b) return null;
  return b.load(id);
}

/** List all presets ([] if persistence off). */
export async function listPresets(): Promise<unknown[]> {
  const b = presets();
  if (!b) return [];
  return b.list();
}

/** Mark a preset used (bumps use_count + last_used_at). */
export async function usePreset(id: string): Promise<unknown | null> {
  const b = presets();
  if (!b) return null;
  return b.use(id);
}
