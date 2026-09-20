import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Minimal D1-compatible facade over `node:sqlite` so route handlers and
 * services can run their real SQL in unit tests. Only the surface AlphaLens
 * uses is implemented: prepare/bind/first/all/run and batch (executed inside a
 * transaction to match D1 batch atomicity).
 */
type BindValue = string | number | null;

class ShimPreparedStatement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly values: BindValue[];

  constructor(db: DatabaseSync, sql: string, values: BindValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: BindValue[]) {
    return new ShimPreparedStatement(this.db, this.sql, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...this.values) as T[];
    return { results: rows, success: true, meta: { duration: 0 } };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number | bigint } }> {
    const info = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: info.lastInsertRowid } };
  }

  /** Synchronous variant used inside a serialised batch transaction. */
  runSync(): { success: true; meta: { changes: number; last_row_id: number | bigint } } {
    const info = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: info.lastInsertRowid } };
  }
}

export class D1Shim {
  private readonly db: DatabaseSync;
  private batchQueue: Promise<unknown> = Promise.resolve();

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(sql: string) {
    return new ShimPreparedStatement(this.db, sql);
  }

  /**
   * Runs a batch inside a transaction. node:sqlite is synchronous, but the
   * surrounding async machinery can interleave two concurrent batches (e.g.
   * concurrent `appendEvent` calls) into a "transaction within a transaction"
   * error. A promise chain serialises batches so each is one atomic transaction,
   * mirroring D1's atomic batch semantics.
   */
  batch(statements: ShimPreparedStatement[]): Promise<Array<{ success: true; meta: { changes: number; last_row_id: number | bigint } }>> {
    const run = () => {
      this.db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(statement.runSync());
        this.db.exec("COMMIT");
        return results;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
    const result = this.batchQueue.then(run, run);
    // Keep the chain alive even if a batch throws.
    this.batchQueue = result.catch(() => {});
    return result;
  }

  close() {
    this.db.close();
  }
}

/** Applies every drizzle migration in order onto an in-memory database. */
export function createMigratedD1(): D1Shim {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(join(process.cwd(), "drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    db.exec(readFileSync(join(process.cwd(), "drizzle", file), "utf8"));
  }
  return new D1Shim(db);
}
