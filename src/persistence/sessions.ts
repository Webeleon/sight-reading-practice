// sessions.ts — DAO for the `sessions` table (brief section 11).
//
// A session is one practice run of the treadmill: created on start (started_at,
// app_version, a JSON config snapshot), updated with ended_at on end. line_attempts
// reference it (session_id FK). DI: every function takes the Database.
//
// No `any` (brief section 16).

import type { Db } from './db.js';

/** A row in `sessions`. Mirrors the columns 1:1 (epoch-ms integers for times). */
export interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  app_version: string;
  config_snapshot: string;
}

/** Args for starting a session. `configSnapshot` is any JSON-serialisable value
 *  (the LineConfig / app settings in effect); it is stringified into the row. */
export interface StartSessionArgs {
  id: string;
  startedAt: number;
  appVersion: string;
  configSnapshot: unknown;
}

/** Insert a new session row (ended_at NULL until ended). Returns the id. */
export function insertSession(db: Db, args: StartSessionArgs): string {
  db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, app_version, config_snapshot)
     VALUES (@id, @started_at, NULL, @app_version, @config_snapshot)`,
  ).run({
    id: args.id,
    started_at: args.startedAt,
    app_version: args.appVersion,
    config_snapshot: JSON.stringify(args.configSnapshot),
  });
  console.log(`[DB] inserted session ${args.id}`);
  return args.id;
}

/** Set ended_at for a session (idempotent — overwrites any prior value). */
export function endSession(db: Db, id: string, endedAt: number): void {
  db.prepare(`UPDATE sessions SET ended_at = @ended_at WHERE id = @id`).run({
    id,
    ended_at: endedAt,
  });
  console.log(`[DB] ended session ${id} at ${endedAt}`);
}

/** Fetch one session by id (or undefined). */
export function getSession(db: Db, id: string): SessionRow | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = @id`).get({ id }) as
    | SessionRow
    | undefined;
}
