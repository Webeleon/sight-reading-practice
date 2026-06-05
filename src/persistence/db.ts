// db.ts — SQLite open + numbered-migration runner (Milestone 5).
//
// NODE / ELECTRON-MAIN layer (tsconfig.node). better-sqlite3 is a NATIVE module:
// after `npm install` it is built for the NODE ABI, which is why the persistence
// layer is unit-testable under vitest (which runs on node) with no rebuild. At
// RUNTIME the DB lives in the Electron MAIN process; the renderer reaches it via
// IPC. Before running the Electron app you must `npm run rebuild:electron` (the
// predev/prepreview scripts do this) to get the Electron ABI; before running
// `npm run verify` again afterwards, `npm run rebuild:node`. See LEARNINGS.md.
//
// DESIGN: dependency-injectable. openDatabase(path) / openInMemory() return a live
// better-sqlite3 Database with all migrations applied; every DAO takes that
// Database as its first argument, so tests open an in-memory DB and pass it in.
// No DAO ever opens its own connection.
//
// No `any` (brief section 16): we import better-sqlite3's own types.

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** The better-sqlite3 Database instance type, re-exported so DAOs and callers can
 *  annotate parameters without importing better-sqlite3 directly. */
export type Db = Database.Database;

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Default directory holding the numbered `NNN_*.sql` migration files: the
 *  `migrations/` folder co-located with THIS source file. Under vitest/tsx this
 *  resolves to src/persistence/migrations. When this module is bundled into the
 *  Electron main bundle, import.meta.url points at the bundle, so the Electron
 *  main process passes an explicit migrationsDir instead (see main.ts). */
export const DEFAULT_MIGRATIONS_DIR = join(moduleDir, 'migrations');

/**
 * Apply every numbered migration that has not yet been applied to `db`, in
 * ascending numeric order. Tracked via SQLite's PRAGMA user_version: a migration
 * file named `NNN_*.sql` is applied iff NNN > user_version, and user_version is
 * bumped to NNN after it runs. Each migration runs inside a transaction so a
 * failing migration leaves the DB untouched.
 *
 * `migrationsDir` defaults to the co-located `migrations/` folder; callers that
 * run from a bundle (Electron main) pass an explicit path. Exported so a caller
 * can run migrations against an externally-created Database (the DI seam), but
 * openDatabase/openInMemory call it for you.
 */
export function runMigrations(
  db: Db,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): void {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => migrationNumber(a) - migrationNumber(b));

  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  for (const file of files) {
    const version = migrationNumber(file);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const applyOne = db.transaction((): void => {
      db.exec(sql);
      // user_version takes a literal, not a bound parameter.
      db.pragma(`user_version = ${version}`);
    });
    applyOne();
    console.log(`[DB] applied migration ${file} (user_version -> ${version})`);
  }
}

/** Parse the leading integer from a migration filename like `001_initial.sql`. */
function migrationNumber(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  if (!match) {
    throw new Error(`[DB] migration file has no numeric prefix: ${filename}`);
  }
  return Number.parseInt(match[1]!, 10);
}

/** Pragmas applied to every freshly opened connection. */
function configureConnection(db: Db): void {
  // Enforce the schema's foreign keys (off by default in SQLite). The schema
  // declares FKs (line_attempts.session_id -> sessions.id, etc.); honour them.
  db.pragma('foreign_keys = ON');
}

/**
 * Open (or create) the on-disk database at `path`, configure the connection, run
 * all pending migrations, and return the live Database. This is what the Electron
 * main process calls (lazily + guarded — see main.ts) with the userData db path.
 * `migrationsDir` lets the Electron main process point at the migrations folder it
 * ships, since import.meta.url resolves to the bundle there, not the source tree.
 */
export function openDatabase(path: string, migrationsDir?: string): Db {
  const db = new Database(path);
  configureConnection(db);
  runMigrations(db, migrationsDir);
  console.log(`[DB] opened database at ${path}`);
  return db;
}

/**
 * Open a fresh in-memory database with the full schema applied. The DI seam for
 * tests: every persistence test opens one of these and hands it to the DAOs, so
 * the suite never touches disk and starts from a clean schema each time.
 */
export function openInMemory(): Db {
  const db = new Database(':memory:');
  configureConnection(db);
  runMigrations(db);
  return db;
}
