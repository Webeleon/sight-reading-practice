// db.ts — SQLite open + numbered-migration runner (Milestone 5).
//
// NODE / ELECTRON-MAIN layer (tsconfig.node). The driver is Node's BUILT-IN
// `node:sqlite` (DatabaseSync) — NOT a native npm module. This matters: there is
// NO native-module ABI problem to manage. The same code loads under vitest (node)
// and inside the Electron MAIN process with no rebuild step, because node:sqlite
// ships with the runtime. (The prototype previously used a native npm SQLite
// module, which could not compile against Electron 42's V8 — see LEARNINGS.md for
// the full migration rationale.) node:sqlite emits a harmless
// `ExperimentalWarning: SQLite is an experimental feature` on stderr; that is
// expected and does not need a flag.
//
// At RUNTIME the DB lives in the Electron MAIN process; the renderer reaches it via
// IPC. No DAO ever opens its own connection.
//
// DESIGN: dependency-injectable. openDatabase(path) / openInMemory() return a live
// Db with all migrations applied; every DAO takes that Db as its first argument, so
// tests open an in-memory DB and pass it in.
//
// The Db type below is a THIN wrapper around DatabaseSync that re-exposes the small
// API surface the DAOs + tests use (prepare/exec/close plus pragma() and
// transaction() helpers, which node:sqlite does not provide natively). The public
// interface (openDatabase / openInMemory / runMigrations / the Db shape) is
// unchanged from the prior driver, so every DAO, stats query, test, and the
// Electron main process compile and behave exactly as before — only the driver
// underneath changed.
//
// No `any` (brief section 16): node:sqlite is fully typed via @types/node.

import { DatabaseSync } from 'node:sqlite';
import type { StatementResultingChanges } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** A named-parameters object: keys match the `@name` / `:name` / `$name`
 *  placeholders (prefix optional), values are bound by node:sqlite (which accepts
 *  null/number/bigint/string/ArrayBufferView). Typed as `object` (not a
 *  Record/index-signature type) so a DAO may pass a structurally matching TYPED
 *  object — e.g. NoteEventRow — without an index signature, exactly as it could
 *  against the prior driver's permissive binding types. `object` still rejects bare
 *  primitives, catching accidental positional misuse; node:sqlite enforces value
 *  types (and throws on a JS boolean) at bind time. */
type NamedParams = object;

/** A prepared statement, narrowed to the methods the DAOs use. `run`/`get`/`all`
 *  take an OPTIONAL named-parameters object (keys match the `@name` placeholders;
 *  omit it for a no-param statement) — the only call forms the DAOs + tests use.
 *  `get`/`all` return `unknown` so call sites narrow with a cast (as the prior
 *  driver did). */
export interface Statement {
  run(params?: NamedParams): StatementResultingChanges;
  get(params?: NamedParams): unknown;
  all(params?: NamedParams): unknown[];
}

/** Options for {@link Db.pragma}. `simple: true` returns the single pragma value
 *  rather than the `{ name: value }` row (matching the prior driver's `simple`). */
interface PragmaOptions {
  simple?: boolean;
}

/**
 * The database handle every DAO + the Electron main process is typed against. A
 * thin facade over node:sqlite's DatabaseSync that adds the two conveniences
 * node:sqlite lacks but the codebase relies on:
 *   - pragma(name[, {simple}])  — node:sqlite has no pragma() helper, so we run
 *     `PRAGMA <name>` / `PRAGMA <expr>` via prepare/exec ourselves.
 *   - transaction(fn)           — node:sqlite has no transaction() helper, so we
 *     wrap fn in BEGIN/COMMIT (ROLLBACK on throw) and return a callable, matching
 *     the prior driver's db.transaction(fn)() usage.
 * prepare/exec/close delegate straight to DatabaseSync.
 */
export class Db {
  private readonly inner: DatabaseSync;
  /** Nesting depth of active transactions, so transaction() is REENTRANT (a nested
   *  call uses a SAVEPOINT instead of a second BEGIN, which SQLite forbids). */
  private txDepth = 0;

  constructor(path: string) {
    this.inner = new DatabaseSync(path);
  }

  /** Prepare a statement. The returned object's run/get/all delegate to
   *  node:sqlite's StatementSync, whose overloads already accept a named-params
   *  object or positional values. */
  prepare(sql: string): Statement {
    return this.inner.prepare(sql) as unknown as Statement;
  }

  /** Run one or more raw SQL statements (DDL, BEGIN/COMMIT, the migration SQL). */
  exec(sql: string): void {
    this.inner.exec(sql);
  }

  /**
   * Read or set a PRAGMA, emulating the prior driver's pragma() helper:
   *   pragma('user_version', { simple: true }) -> the number
   *   pragma('user_version = 5')               -> sets it (runs as a statement)
   *   pragma('foreign_keys = ON')              -> sets it
   * A bare name (no `=`) is a READ: returns the `{ name: value }` row, or just the
   * value when `simple` is set. An assignment (`name = value`) is executed.
   */
  pragma(
    source: string,
    options: PragmaOptions = {},
  ): unknown {
    if (source.includes('=')) {
      // Assignment form: PRAGMA name = value. user_version etc. take a literal,
      // not a bound parameter, so this is always a trusted internal string.
      this.inner.exec(`PRAGMA ${source}`);
      return undefined;
    }
    const row = this.inner.prepare(`PRAGMA ${source}`).get() as
      | Record<string, unknown>
      | undefined;
    if (options.simple) {
      // The pragma name is the (single) column key; return its value.
      if (!row) return undefined;
      const values = Object.values(row);
      return values.length > 0 ? values[0] : undefined;
    }
    return row;
  }

  /**
   * Wrap `fn` in a manual transaction and return a callable that runs it, rolling
   * back on any throw. Mirrors the prior driver's `db.transaction(fn)` (which returns
   * a function you then call) — including its REENTRANCY: node:sqlite has no
   * transaction() helper and a bare nested BEGIN throws "cannot start a transaction
   * within a transaction", so a top-level call uses BEGIN/COMMIT while a nested call
   * (e.g. insertNoteEvents running inside the attempt-write transaction) uses a
   * SAVEPOINT, so transactions compose. Depth-keyed savepoint names are unique
   * because calls are synchronous and strictly LIFO-nested.
   */
  transaction(fn: () => void): () => void {
    return (): void => {
      const depth = this.txDepth;
      const sp = `sp_${depth}`;
      if (depth === 0) this.inner.exec('BEGIN');
      else this.inner.exec(`SAVEPOINT ${sp}`);
      this.txDepth = depth + 1;
      try {
        fn();
        if (depth === 0) this.inner.exec('COMMIT');
        else this.inner.exec(`RELEASE ${sp}`);
        this.txDepth = depth;
      } catch (err) {
        if (depth === 0) {
          this.inner.exec('ROLLBACK');
        } else {
          // Undo just this savepoint's work, then discard the savepoint.
          this.inner.exec(`ROLLBACK TO ${sp}`);
          this.inner.exec(`RELEASE ${sp}`);
        }
        this.txDepth = depth;
        throw err;
      }
    };
  }

  /** Close the underlying connection. */
  close(): void {
    this.inner.close();
  }
}

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
 * can run migrations against an externally-created Db (the DI seam), but
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
 * all pending migrations, and return the live Db. This is what the Electron main
 * process calls (lazily + guarded — see main.ts) with the userData db path.
 * `migrationsDir` lets the Electron main process point at the migrations folder it
 * ships, since import.meta.url resolves to the bundle there, not the source tree.
 */
export function openDatabase(path: string, migrationsDir?: string): Db {
  const db = new Db(path);
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
  const db = new Db(':memory:');
  configureConnection(db);
  runMigrations(db);
  return db;
}
