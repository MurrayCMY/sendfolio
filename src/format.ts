import { appConfig, t } from "./i18n";
/** 83000 ms -> "1m 23s"; 45000 -> "45s"; under a second -> "<1s". */
export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s <= 0) return ms > 0 ? t("<1s") : t("0s");
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return t("{0}s", sec);
  if (m < 60) return t("{0}m {1}s", m, String(sec).padStart(2, "0"));
  return t("{0}h {1}m", Math.floor(m / 60), m % 60);
}

export const deviceLabel = (d: string | null, wechat: boolean | null) =>
  `${d === "mobile" ? t("Phone") : d === "tablet" ? t("Tablet") : d === "desktop" ? t("Computer") : "—"}${wechat ? t(" (in WeChat)") : ""}`;

export const geoLabel = (city: string | null, country: string | null) => [city, country].filter(Boolean).join(" · ") || "—";

const COUNTRY: Record<string, string> = {
  "China": "CN", "Hong Kong": "HK", "Macao": "MO", "Taiwan": "TW", "United States": "US", "Canada": "CA", "United Kingdom": "GB",
  "Singapore": "SG", "Japan": "JP", "South Korea": "KR", "Germany": "DE", "France": "FR", "Netherlands": "NL", "Switzerland": "CH",
  "Australia": "AU", "New Zealand": "NZ", "India": "IN", "Ireland": "IE", "Sweden": "SE", "Italy": "IT", "Spain": "ES", "Israel": "IL",
  "United Arab Emirates": "AE", "Malaysia": "MY", "Thailand": "TH", "Vietnam": "VN", "Indonesia": "ID", "Philippines": "PH",
  "Brazil": "BR", "Russia": "RU", "Luxembourg": "LU", "Denmark": "DK", "Norway": "NO", "Finland": "FI", "Belgium": "BE", "Austria": "AT",
};
/** Flag emoji for an English country name (Windows shows the two-letter code instead, which is still compact). */
export function countryFlag(country: string | null): { flag: string; code: string } | null {
  const code = country ? COUNTRY[country] : undefined;
  if (!code) return null;
  return { code, flag: String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) };
}
/** "🇺🇸 Irvine" - the flag stands in for the country name; unknown countries keep their name. */
export function geoShort(city: string | null, country: string | null): string {
  const f = countryFlag(country);
  const place = city || (f ? "" : country) || "";
  return [f?.flag, place].filter(Boolean).join(" ") || "—";
}

/** Date formatters for the server time zone (appConfig.timezone), built once the setting is known. */
const tzFormatters = new Map<string, Intl.DateTimeFormat>();
export function tzFormat(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = appConfig.timezone + JSON.stringify(opts);
  let f = tzFormatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat("sv-SE", { timeZone: appConfig.timezone, ...opts }); tzFormatters.set(key, f); }
  return f;
}
const minuteFormat = () => tzFormat({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Time in the server time zone, "2026-11-24 15:30". */
export const fmtTime = (iso: string | null) => (iso ? minuteFormat().format(new Date(iso)) : "—");

/** "3 h ago" for the last day or so, otherwise the date. */
export function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t("Just now");
  if (s < 3600) return t("{0} min ago", Math.floor(s / 60));
  if (s < 86400) return t("{0} h ago", Math.floor(s / 3600));
  if (s < 86400 * 7) return t("{0} d ago", Math.floor(s / 86400));
  return fmtTime(iso).slice(0, 10);
}

/** The address investors open, e.g. https://docs.example.com/acme */
export const linkUrl = (slug: string) => `${location.origin}/${slug}`;

export const linkStatus = (l: { enabled: boolean; expires_at: string | null }, archived = false): { text: string; tone: "ok" | "muted" | "warn" } => {
  if (archived) return { text: t("Document archived"), tone: "muted" };
  if (!l.enabled) return { text: t("Disabled"), tone: "muted" };
  if (l.expires_at && new Date(l.expires_at) <= new Date()) return { text: t("Expired"), tone: "warn" };
  return { text: t("Active"), tone: "ok" };
};

export const STATUS_KEYS = ["new", "contacted", "meeting", "declined"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
const STATUS_TONE: Record<StatusKey, "muted" | "info" | "ok" | "bad"> = { new: "muted", contacted: "info", meeting: "ok", declined: "bad" };
const statusLabel = (k: StatusKey) => (k === "new" ? t("Not contacted") : k === "contacted" ? t("Contacted") : k === "meeting" ? t("Meeting set") : t("Declined"));
/** Follow-up status of a visitor (null = not contacted yet). */
export const visitorStatus = (s: string | null | undefined) => {
  const k: StatusKey = (STATUS_KEYS as readonly string[]).includes(s ?? "") ? (s as StatusKey) : "new";
  return { key: k, label: statusLabel(k), tone: STATUS_TONE[k] };
};
export const visitorStatusList = () => STATUS_KEYS.map((k) => visitorStatus(k));

/**
 * Interest signal from behaviour: came back, or read deeply (>= 60% of the deck or >= 5 minutes).
 * Both = high; either = worth watching. Deliberately simple so the admin can explain it to themself.
 */
export function intentOf(v: { visits: number; depth?: number; total_ms: number }): "hot" | "warm" | null {
  const deep = (v.depth ?? 0) >= 0.6 || v.total_ms >= 5 * 60000;
  if (v.visits >= 2 && deep) return "hot";
  if (v.visits >= 2 || deep) return "warm";
  return null;
}
export function intentReason(v: { visits: number; depth?: number; total_ms: number }): string {
  const parts: string[] = [];
  if (v.visits >= 2) parts.push(t("Viewed {0} times", v.visits));
  if ((v.depth ?? 0) >= 0.6) parts.push(t("Reached {0}%", Math.round((v.depth ?? 0) * 100)));
  if (v.total_ms >= 5 * 60000) parts.push(t("{0} in total", fmtDur(v.total_ms)));
  return parts.join(t(", "));
}
