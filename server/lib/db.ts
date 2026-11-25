/**
 * Database access. One small surface (`db.sql` tagged template, `db.sql.unsafe`, `db.pool.connect()` for
 * transactions) with three interchangeable drivers:
 *
 *   DATABASE_URL set       -> any PostgreSQL (docker compose, Neon, Supabase, RDS, Railway ...)
 *   NETLIFY_DB_URL set     -> Netlify Database (it is plain Postgres, injected by Netlify)
 *   neither                -> embedded PGlite stored in ./data/pglite (zero-setup try-out and tiny deployments)
 *
 * Rows come back as plain objects. bigint columns are returned as strings (like node-postgres), so cast counts
 * with ::int in SQL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export interface QueryResult { rows: Row[]; rowCount: number | null }
export interface Queryable { query(text: string, params?: unknown[]): Promise<QueryResult> }
export interface PoolClient extends Queryable { exec(text: string): Promise<void>; release(): void }
interface Driver extends Queryable {
  /** Run several statements in one go (used by the migration runner). */
  exec(text: string): Promise<void>;
  connect(): Promise<PoolClient>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
}

export type Sql = {
  <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe(text: string, params?: unknown[]): Promise<Row[]>;
};

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
  if (url) {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_SIZE ?? 5) });
    pool.on("error", (e: Error) => console.error("database pool error", e.message));
    return {
      kind: "postgres",
      query: (t, p) => pool.query(t, p as unknown[]) as Promise<QueryResult>,
      exec: async (t) => { await pool.query(t); },
      connect: async () => {
        const c = await pool.connect();
        return {
          query: (t, p) => c.query(t, p as unknown[]) as Promise<QueryResult>,
          exec: async (t) => { await c.query(t); },
          release: () => c.release(),
        };
      },
      close: () => pool.end(),
    };
  }

  // The package name sits in a variable so bundlers (Netlify) do not try to include the WASM database;
  // it is only ever loaded when no PostgreSQL URL is configured.
  const pgliteModule = "@electric-sql/pglite";
  const { PGlite } = (await import(pgliteModule)) as typeof import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? "./data/pglite";
  const { mkdirSync } = await import("node:fs");
  if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
  // 20 = int8: keep it a string, exactly like node-postgres does.
  const lite = new PGlite(dir, { parsers: { 20: (v: string) => v } });
  await lite.waitReady;
  console.log(`[db] using embedded PGlite at ${dir} (set DATABASE_URL to use PostgreSQL)`);

  // PGlite has one connection: serialise queries, and hold the lock for a whole transaction.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
  const q = async (t: string, p?: unknown[]): Promise<QueryResult> => {
    const r = await lite.query(t, p as unknown[]);
    return { rows: r.rows as Row[], rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
  };
  return {
    kind: "pglite",
    query: (t, p) => exclusive(() => q(t, p)),
    exec: (t) => exclusive(async () => { await lite.exec(t); }),
    connect: async () => {
      let release!: () => void;
      const held = new Promise<void>((res) => (release = res));
      await new Promise<void>((ready) => { void exclusive(async () => { ready(); await held; }); });
      return { query: q, exec: async (t) => { await lite.exec(t); }, release };
    },
    close: () => lite.close(),
  };
}

const driver = await createDriver();

function build(strings: TemplateStringsArray, values: unknown[]) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
  return { text, params: values };
}

const sql = Object.assign(
  async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = build(strings, values);
    return (await driver.query(text, params)).rows;
  },
  { unsafe: async (text: string, params: unknown[] = []) => (await driver.query(text, params)).rows },
) as unknown as Sql;

export const db = {
  sql,
  pool: { connect: () => driver.connect() },
  kind: driver.kind,
  query: (text: string, params?: unknown[]) => driver.query(text, params),
  exec: (text: string) => driver.exec(text),
  close: () => driver.close(),
};
