import { randomInt } from "node:crypto";
import { db } from "./db";

// Link addresses: random 10-character codes, or a custom word such as "acme" (3-40 characters).
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;
const RESERVED = new Set(["admin", "api", "assets", "favicon", "robots", "index", "login", "logout", "static", "netlify"]);

/** Returns an error message, or null if the slug may be used. */
export function validateSlug(s: string): string | null {
  if (!SLUG_RE.test(s)) return "A link address may only contain letters, numbers, hyphens and underscores, 3 to 40 characters, starting with a letter or number.";
  if (RESERVED.has(s.toLowerCase())) return "This address is reserved by the system. Please choose another.";
  return null;
}
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const newSlug = (len = 10) =>
  Array.from({ length: len }, () => BASE62[randomInt(0, BASE62.length)]).join("");

export interface LinkRow {
  id: string;
  document_id: string;
  pinned_version_id: string | null;
  slug: string;
  name: string;
  enabled: boolean;
  expires_at: string | null;
  require_email: boolean;
  require_otp: boolean;
  block_personal_email: boolean;
  allowed_domains: string[] | null;
  require_nda: boolean;
  password_hash: string | null;
  allow_download: boolean;
  watermark: boolean;
  watermark_fields: string[] | null;
  watermark_text: string | null;
  notify_on_open: boolean;
  doc_title: string;
  doc_archived_at: string | null;
}

export async function loadLinkBySlug(slug: string): Promise<LinkRow | null> {
  if (!SLUG_RE.test(slug)) return null;
  const [row] = await db.sql<LinkRow>`
    select l.id, l.document_id, l.pinned_version_id, l.slug, l.name, l.enabled, l.expires_at,
           l.require_email, l.require_otp, l.block_personal_email, l.allowed_domains, l.require_nda,
           l.password_hash, l.allow_download, l.watermark, l.watermark_fields, l.watermark_text, l.notify_on_open,
           d.title as doc_title, d.archived_at as doc_archived_at
    from links l join documents d on d.id = l.document_id
    where lower(l.slug) = lower(${slug})`;
  return row ?? null;
}

/** Disabled, expired and archived-document links all look the same to visitors. */
export function linkUsable(l: LinkRow): boolean {
  return l.enabled && !l.doc_archived_at && (!l.expires_at || new Date(l.expires_at) > new Date());
}

export async function resolveVersion(l: LinkRow) {
  const [v] = l.pinned_version_id
    ? await db.sql<{ id: string; version_label: string; page_count: number }>`
        select id, version_label, page_count from document_versions
        where id = ${l.pinned_version_id} and status = 'ready'`
    : await db.sql<{ id: string; version_label: string; page_count: number }>`
        select id, version_label, page_count from document_versions
        where document_id = ${l.document_id} and status = 'ready' order by created_at desc limit 1`;
  return v ?? null;
}

export async function personalDomains(): Promise<string[]> {
  const [row] = await db.sql<{ value: string[] }>`select value from settings where key = 'personal_email_domains'`;
  return row?.value ?? [];
}
