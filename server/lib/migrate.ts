import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

/**
 * Applies the SQL files in netlify/database/migrations in name order, once each. (That folder name is what
 * Netlify Database expects, so the same files serve every deployment target.)
 *
 * - Applied files are recorded in schema_migrations with a checksum. Editing an applied file is refused,
 *   because a database that already ran the old text would silently differ. Add a new file instead.
 * - Line endings are normalised before hashing, so a Windows checkout and a Linux checkout agree.
 * - Several processes may start at once (serverless cold starts): an advisory lock makes them take turns.
 * - On Netlify with Netlify Database the platform applies the migrations at deploy time, so this does nothing there.
 */
export async function migrate(dir = process.env.MIGRATIONS_DIR ?? "netlify/database/migrations"): Promise<string[]> {
  if (process.env.NETLIFY === "true" && !process.env.DATABASE_URL) return [];
  const client = await db.pool.connect();
  const ran: string[] = [];
  try {
    if (db.kind === "postgres") await client.query("select pg_advisory_lock(727274)");
    await client.exec(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const applied = new Map((await client.query("select name, checksum from schema_migrations")).rows.map((r) => [String(r.name), String(r.checksum)]));
    const names = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of names) {
      const name = file.replace(/\.sql$/, "");
      const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(text).digest("hex");
      const prev = applied.get(name);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${name} was modified after it was applied. Never edit an applied migration; add a new one.`);
        continue;
      }
      // One multi-statement call is a single implicit transaction, and the bookkeeping row rides along in it.
      await client.exec(`${text}\n;insert into schema_migrations (name, checksum) values ('${name.replace(/'/g, "''")}', '${checksum}');`);
      ran.push(name);
    }
  } finally {
    if (db.kind === "postgres") await client.query("select pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
  return ran;
}
