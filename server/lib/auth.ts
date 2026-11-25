import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { parseCookies } from "./http";

/** The Secure cookie flag needs HTTPS: set it whenever SITE_URL is an https address (plain-http trials still work). */
const secure = () => (config.siteUrl().startsWith("https://") ? "; Secure" : "");

export const ADMIN_COOKIE = "sendfolio_admin";
const SESSION_TTL_SEC = 14 * 24 * 3600;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  return s;
}

const b64 = (b: Buffer) => b.toString("base64url");
const hmac = (data: string) => createHmac("sha256", secret()).update(data).digest();

export function signToken(payload: Record<string, unknown>, ttlSec: number): string {
  const body = b64(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })));
  return `${body}.${b64(hmac(body))}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function adminCookie(): string {
  const token = signToken({ role: "admin" }, SESSION_TTL_SEC);
  return `${ADMIN_COOKIE}=${token}; HttpOnly${secure()}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearAdminCookie(): string {
  return `${ADMIN_COOKIE}=; HttpOnly${secure()}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function isAdmin(req: Request): boolean {
  const t = verifyToken<{ role: string }>(parseCookies(req.headers.get("cookie"))[ADMIN_COOKIE]);
  return t?.role === "admin";
}

/* ---- link access password (scrypt) ---- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const given = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* ---- visitor session: bound to one link, 30 days ---- */

export interface VisitorSession extends Record<string, unknown> {
  k: "visitor";
  lid: string;
  vid: string | null;
  email: string | null;
  name: string | null;
}

const VISITOR_TTL_SEC = 30 * 24 * 3600;
export const visitorCookieName = (slug: string) => `sfv_${slug}`;

export function visitorCookie(slug: string, s: Omit<VisitorSession, "k">): string {
  const token = signToken({ ...s, k: "visitor" }, VISITOR_TTL_SEC);
  return `${visitorCookieName(slug)}=${token}; HttpOnly${secure()}; SameSite=Lax; Path=/; Max-Age=${VISITOR_TTL_SEC}`;
}

export function readVisitor(req: Request, slug: string, linkId: string): VisitorSession | null {
  const t = verifyToken<VisitorSession>(parseCookies(req.headers.get("cookie"))[visitorCookieName(slug)]);
  return t && t.k === "visitor" && t.lid === linkId ? t : null;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(email: string, purpose: string, code: string): string {
  return hmac(`otp:${purpose}:${email}:${code}`).toString("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
