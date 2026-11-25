import { db } from "./db";

/** True if `key` already has >= `limit` events of `kind` in the last `windowSec` seconds. */
export async function overLimit(kind: string, key: string, limit: number, windowSec: number): Promise<boolean> {
  const [row] = await db.sql<{ n: number }>`
    select count(*)::int as n from rate_events
    where kind = ${kind} and key = ${key} and created_at > now() - make_interval(secs => ${windowSec})`;
  return row.n >= limit;
}

export async function record(kind: string, key: string): Promise<void> {
  await db.sql`insert into rate_events (kind, key) values (${kind}, ${key})`;
}
