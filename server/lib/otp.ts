import { db } from "./db";
import { generateCode, hashCode, safeEqualHex } from "./auth";

export const OTP_TTL_MIN = 10;

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: "rate" | "wait"; retryAfter?: number };

/**
 * Create a one-time code. Limits: 60 s between sends per email, 5 per email per hour, 10 per IP per hour.
 * With `store: false` only the attempt is recorded (used for unknown admin emails, so limits still apply).
 */
export async function issueOtp(
  email: string,
  purpose: "visitor" | "admin",
  ip: string,
  store = true,
): Promise<IssueResult> {
  const [byEmail] = await db.sql<{ n: number }>`
    select count(*)::int as n from otp_codes
    where purpose = ${purpose} and email = ${email} and created_at > now() - interval '1 hour'`;
  const [byIp] = await db.sql<{ n: number }>`
    select count(*)::int as n from otp_codes
    where purpose = ${purpose} and ip = ${ip} and created_at > now() - interval '1 hour'`;
  if (byEmail.n >= 5 || byIp.n >= 10) return { ok: false, reason: "rate" };

  const [last] = await db.sql<{ age: number }>`
    select extract(epoch from now() - created_at)::int as age from otp_codes
    where purpose = ${purpose} and email = ${email} order by created_at desc limit 1`;
  if (last && last.age < 60) return { ok: false, reason: "wait", retryAfter: 60 - last.age };

  const code = generateCode();
  if (store) {
    await db.sql`
      insert into otp_codes (email, purpose, code_hash, expires_at, ip)
      values (${email}, ${purpose}, ${hashCode(email, purpose, code)},
              now() + make_interval(mins => ${OTP_TTL_MIN}), ${ip})`;
  } else {
    await db.sql`
      insert into otp_codes (email, purpose, code_hash, expires_at, ip, consumed_at)
      values (${email}, ${purpose}, '', now(), ${ip}, now())`;
  }
  return { ok: true, code };
}

/** Valid for 10 minutes, at most 5 attempts per code, single use. */
export async function checkOtp(email: string, purpose: "visitor" | "admin", code: string): Promise<boolean> {
  const [row] = await db.sql<{ id: string; code_hash: string; attempts: number }>`
    select id, code_hash, attempts from otp_codes
    where purpose = ${purpose} and email = ${email} and consumed_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!row || row.attempts >= 5) return false;
  await db.sql`update otp_codes set attempts = attempts + 1 where id = ${row.id}`;
  if (!/^\d{6}$/.test(code) || !safeEqualHex(row.code_hash, hashCode(email, purpose, code))) return false;
  await db.sql`update otp_codes set consumed_at = now() where id = ${row.id}`;
  return true;
}
