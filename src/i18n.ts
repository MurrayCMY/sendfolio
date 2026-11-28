import { useEffect, useState } from "preact/hooks";
import { zh } from "./locales/zh";

/**
 * Tiny i18n layer. The English text itself is the key: `t("Copy link")`. The Chinese dictionary (locales/zh.ts)
 * maps English -> 简体中文, and a missing entry simply shows English. Placeholders are positional: `t("{0} visits", n)`.
 *
 * To add a language: create locales/<code>.ts like zh.ts, register it in DICTS and LANGS below,
 * and add the code to Locale in server/lib/config.ts. `npm run i18n:check` lists strings that have no translation.
 */
export type Lang = "en" | "zh";
export const LANGS: { code: Lang; label: string }[] = [{ code: "en", label: "English" }, { code: "zh", label: "中文" }];
const DICTS: Record<Lang, Record<string, string>> = { en: {}, zh };

/** Filled from /api/v/_/config at start-up (see loadConfig). */
export const appConfig = {
  appName: "SendFolio",
  brandColor: "#141413",
  logoUrl: null as string | null,
  ctaLabel: null as string | null,
  ctaUrl: null as string | null,
  defaultLocale: "en" as Lang,
  timezone: "UTC",
};

export function applyBrandTheme(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  appConfig.brandColor = hex;
  const r = document.documentElement.style;
  r.setProperty("--primary", hex);
  r.setProperty("--a-primary", hex);
}

const STORAGE_KEY = "sendfolio_lang";
let current: Lang = "en";
const subscribers = new Set<() => void>();

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);
const saved = (): Lang | null => { try { const v = localStorage.getItem(STORAGE_KEY); return isLang(v) ? v : null; } catch { return null; } };

export const getLang = () => current;

export function setLang(lang: Lang, persist = true) {
  current = lang;
  if (persist) { try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ } }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  subscribers.forEach((f) => f());
}

/** Translate `text` (English) into the current language and fill `{0}`, `{1}` ... */
export function t(text: string, ...args: (string | number | null | undefined)[]): string {
  const s = DICTS[current][text] ?? text;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : s;
}

/** Re-renders the caller when the language changes. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subscribers.add(f);
    return () => { subscribers.delete(f); };
  }, []);
  return [current, setLang];
}

/**
 * Loads the deployment settings (brand name, default language, time zone) and picks the starting language:
 * a saved choice wins; otherwise visitors get their browser language if we have it, and everyone else the default.
 */
export async function loadConfig(): Promise<void> {
  try {
    const r = await fetch("/api/v/_/config");
    if (r.ok) {
      const c = await r.json();
      if (typeof c.app_name === "string" && c.app_name.trim()) appConfig.appName = c.app_name;
      if (typeof c.brand_color === "string") applyBrandTheme(c.brand_color);
      appConfig.logoUrl = typeof c.logo_url === "string" ? c.logo_url : null;
      appConfig.ctaLabel = typeof c.cta_label === "string" ? c.cta_label : null;
      appConfig.ctaUrl = typeof c.cta_url === "string" ? c.cta_url : null;
      if (isLang(c.default_locale)) appConfig.defaultLocale = c.default_locale;
      if (typeof c.timezone === "string") appConfig.timezone = c.timezone;
    }
  } catch { /* offline or old server: keep the defaults */ }
  const isAdmin = location.pathname.startsWith("/admin");
  const browser: Lang | null = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase().startsWith("zh") ? "zh" : null;
  setLang(saved() ?? (!isAdmin && browser ? browser : null) ?? appConfig.defaultLocale, false);
}
