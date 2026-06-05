// presets.ts — DAO for the `presets` table (brief section 11).
//
// A preset is a named, reusable LineConfig (config_json). save/load round-trips
// the config; usePreset() bumps use_count and stamps last_used_at so the UI can
// surface frequently/recently used presets. DI: every function takes the Database.
//
// No `any` (brief section 16).

import type { Db } from './db.js';

/** A row in `presets`, mirroring the columns 1:1. */
export interface PresetRow {
  id: string;
  name: string;
  config_json: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
}

/** A preset with its config parsed back into an object (load convenience). */
export interface Preset<TConfig = unknown> {
  id: string;
  name: string;
  config: TConfig;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
}

export interface SavePresetArgs {
  id: string;
  name: string;
  /** Any JSON-serialisable config (e.g. a LineConfig); stringified into the row. */
  config: unknown;
  /** epoch ms; used for both created_at and updated_at on first insert, and for
   *  updated_at on a re-save of an existing id. */
  now: number;
}

/**
 * Insert a new preset, or update name/config_json/updated_at of an existing one
 * (upsert by id). created_at and use_count are preserved on update; use_count
 * starts at 0 on insert (the schema default). Returns the id.
 */
export function savePreset(db: Db, args: SavePresetArgs): string {
  db.prepare(
    `INSERT INTO presets (id, name, config_json, created_at, updated_at, last_used_at, use_count)
     VALUES (@id, @name, @config_json, @now, @now, NULL, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       config_json = excluded.config_json,
       updated_at = excluded.updated_at`,
  ).run({
    id: args.id,
    name: args.name,
    config_json: JSON.stringify(args.config),
    now: args.now,
  });
  console.log(`[DB] saved preset ${args.id} ("${args.name}")`);
  return args.id;
}

/** Map a raw row to a Preset with parsed config. */
function toPreset<TConfig>(row: PresetRow): Preset<TConfig> {
  return {
    id: row.id,
    name: row.name,
    config: JSON.parse(row.config_json) as TConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}

/** Load one preset by id (parsed config), or undefined if not found. */
export function loadPreset<TConfig = unknown>(
  db: Db,
  id: string,
): Preset<TConfig> | undefined {
  const row = db.prepare(`SELECT * FROM presets WHERE id = @id`).get({ id }) as
    | PresetRow
    | undefined;
  return row ? toPreset<TConfig>(row) : undefined;
}

/** List all presets (parsed config), most-recently-used first then by name. */
export function listPresets<TConfig = unknown>(db: Db): Array<Preset<TConfig>> {
  const rows = db
    .prepare(
      `SELECT * FROM presets ORDER BY last_used_at DESC NULLS LAST, name ASC`,
    )
    .all() as PresetRow[];
  return rows.map((r) => toPreset<TConfig>(r));
}

/**
 * Mark a preset as USED: increment use_count and set last_used_at = `now`.
 * Returns the updated Preset, or undefined if the id does not exist.
 */
export function usePreset<TConfig = unknown>(
  db: Db,
  id: string,
  now: number,
): Preset<TConfig> | undefined {
  const info = db
    .prepare(
      `UPDATE presets
         SET use_count = use_count + 1, last_used_at = @now
       WHERE id = @id`,
    )
    .run({ id, now });
  if (info.changes === 0) {
    console.warn(`[DB] usePreset: no preset with id ${id}`);
    return undefined;
  }
  console.log(`[DB] used preset ${id} (last_used_at=${now})`);
  return loadPreset<TConfig>(db, id);
}

/** Delete a preset by id. Returns true if a row was removed. */
export function deletePreset(db: Db, id: string): boolean {
  const info = db.prepare(`DELETE FROM presets WHERE id = @id`).run({ id });
  return info.changes > 0;
}
