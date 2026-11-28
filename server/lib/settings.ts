import { config } from "./config";
import { db } from "./db";

export interface BrandingSettings {
  app_name: string;
  brand_color: string;
  logo_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
}

export type WebhookKind = "slack" | "lark" | "generic";

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  kind: WebhookKind;
  enabled: boolean;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.sql<{ value: T }>`select value from settings where key = ${key}`;
  return row ? row.value : null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.sql`
    insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value`;
}

/* ---------------- Branding & Reader CTA ---------------- */

export async function getBranding(): Promise<BrandingSettings> {
  const saved = (await readSetting<Partial<BrandingSettings>>("branding")) ?? {};
  return {
    app_name: typeof saved.app_name === "string" && saved.app_name.trim() ? saved.app_name.trim().slice(0, 60) : config.appName,
    brand_color: typeof saved.brand_color === "string" && HEX_RE.test(saved.brand_color) ? saved.brand_color : config.brandColor,
    logo_url: typeof saved.logo_url === "string" && saved.logo_url.startsWith("data:image/") && saved.logo_url.length <= 160_000 ? saved.logo_url : null,
    cta_label: typeof saved.cta_label === "string" && saved.cta_label.trim() ? saved.cta_label.trim().slice(0, 40) : null,
    cta_url: typeof saved.cta_url === "string" && /^(https?:\/\/|mailto:)/i.test(saved.cta_url.trim()) ? saved.cta_url.trim().slice(0, 300) : null,
  };
}

export async function saveBranding(input: Record<string, unknown>): Promise<BrandingSettings> {
  const app_name = String(input.app_name ?? "").trim().slice(0, 60) || config.appName;
  const rawColor = String(input.brand_color ?? "").trim();
  const brand_color = HEX_RE.test(rawColor) ? rawColor : config.brandColor;
  const rawLogo = typeof input.logo_url === "string" ? input.logo_url.trim() : "";
  const logo_url = rawLogo.startsWith("data:image/") && rawLogo.length <= 160_000 ? rawLogo : null;
  const cta_label = String(input.cta_label ?? "").trim().slice(0, 40) || null;
  const rawCta = String(input.cta_url ?? "").trim().slice(0, 300);
  const cta_url = rawCta && /^(https?:\/\/|mailto:)/i.test(rawCta) ? rawCta : null;
  const next: BrandingSettings = { app_name, brand_color, logo_url, cta_label, cta_url };
  await writeSetting("branding", next);
  return next;
}

/* ---------------- Multi-Admin ---------------- */

export function envAdminEmails(): string[] {
  const raw = `${process.env.ADMIN_EMAIL ?? ""},${process.env.ADMIN_EMAILS ?? ""}`;
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)))];
}

export async function getExtraAdminEmails(): Promise<string[]> {
  const saved = (await readSetting<string[]>("admin_emails")) ?? [];
  const primary = new Set(envAdminEmails());
  return [...new Set(saved.map((s) => String(s).trim().toLowerCase()).filter((s) => EMAIL_RE.test(s) && !primary.has(s)))];
}

export async function getAllAdminEmails(): Promise<string[]> {
  return [...new Set([...envAdminEmails(), ...(await getExtraAdminEmails())])];
}

export async function saveExtraAdminEmails(emails: unknown): Promise<string[]> {
  const list = Array.isArray(emails) ? emails : [];
  const primary = new Set(envAdminEmails());
  const clean = [...new Set(list.map((s) => String(s ?? "").trim().toLowerCase()).filter((s) => EMAIL_RE.test(s) && !primary.has(s)))].slice(0, 20);
  await writeSetting("admin_emails", clean);
  return clean;
}

/* ---------------- Webhooks (Slack, Lark/Feishu, Generic) ---------------- */

export async function getWebhooks(): Promise<WebhookConfig[]> {
  const saved = (await readSetting<WebhookConfig[]>("webhooks")) ?? [];
  if (!Array.isArray(saved)) return [];
  return saved.filter((w) => w && typeof w.url === "string" && /^https?:\/\//i.test(w.url));
}

export async function saveWebhooks(input: unknown): Promise<WebhookConfig[]> {
  const list = Array.isArray(input) ? input : [];
  const clean: WebhookConfig[] = [];
  for (const item of list.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = String(o.url ?? "").trim().slice(0, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    const kind: WebhookKind = o.kind === "slack" || o.kind === "lark" ? o.kind : "generic";
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 40) : crypto.randomUUID().slice(0, 8);
    const name = String(o.name ?? "").trim().slice(0, 60) || (kind === "slack" ? "Slack" : kind === "lark" ? "Lark / Feishu" : "Webhook");
    clean.push({ id, name, url, kind, enabled: o.enabled !== false });
  }
  await writeSetting("webhooks", clean);
  return clean;
}

export interface WebhookEventPayload {
  event: "open" | "summary" | "test";
  title: string;
  body: string;
  forwarded?: boolean;
  admin_url?: string;
  meta?: Record<string, unknown>;
}

function formatWebhookBody(kind: WebhookKind, p: WebhookEventPayload): unknown {
  if (kind === "slack") {
    const blocks: unknown[] = [
      { type: "section", text: { type: "mrkdwn", text: `*${p.title}*\n${p.body}` } },
    ];
    if (p.admin_url) {
      blocks.push({
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open in SendFolio" }, url: p.admin_url }],
      });
    }
    return { text: `${p.title} — ${p.body}`, blocks };
  }
  if (kind === "lark") {
    const elements: unknown[] = [{ tag: "div", text: { tag: "lark_md", content: p.body } }];
    if (p.admin_url) {
      elements.push({
        tag: "action",
        actions: [{ tag: "button", text: { tag: "plain_text", content: "Open in SendFolio" }, url: p.admin_url, type: "primary" }],
      });
    }
    return {
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: p.title },
          template: p.forwarded ? "orange" : "indigo",
        },
        elements,
      },
    };
  }
  return { event: p.event, timestamp: new Date().toISOString(), title: p.title, body: p.body, forwarded: !!p.forwarded, admin_url: p.admin_url ?? null, ...(p.meta ?? {}) };
}

export async function postWebhook(hook: WebhookConfig, payload: WebhookEventPayload): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatWebhookBody(hook.kind, payload)),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 160) };
  }
}

export async function deliverWebhooks(payload: WebhookEventPayload): Promise<void> {
  const hooks = (await getWebhooks()).filter((h) => h.enabled);
  if (!hooks.length) return;
  await Promise.allSettled(hooks.map((h) => postWebhook(h, payload)));
}
