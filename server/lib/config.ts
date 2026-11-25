/** Deployment-level settings, all from environment variables (see .env.example). */
export type Locale = "en" | "zh";

const tz = (() => {
  const v = process.env.TIMEZONE || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return v; } catch { return "UTC"; }
})();

export const config = {
  /** Shown in the UI, emails and PDFs. Rename it to rebrand the whole app. */
  appName: (process.env.APP_NAME || "SendFolio").trim(),
  /** Legal or display name of the organisation sharing documents (NDA, confirmation emails). Defaults to APP_NAME. */
  companyName: (process.env.COMPANY_NAME || process.env.APP_NAME || "SendFolio").trim(),
  /** Accent colour used in emails (hex). The web UI colours live in src/styles.css (:root) and src/admin/admin.css (.admin). */
  brandColor: /^#[0-9a-fA-F]{6}$/.test(process.env.BRAND_COLOR ?? "") ? process.env.BRAND_COLOR! : "#3949AB",
  /** Language used until a person picks one, and for emails to the admin. */
  defaultLocale: (process.env.DEFAULT_LOCALE === "zh" ? "zh" : "en") as Locale,
  /** IANA time zone for dates in the admin, emails and watermarks, e.g. Asia/Shanghai. */
  timezone: tz,
  siteUrl: () => (process.env.SITE_URL ?? "").replace(/\/$/, ""),
  adminEmail: () => (process.env.ADMIN_EMAIL ?? "").trim(),
};

export const pickLocale = (v: unknown): Locale => (v === "zh" ? "zh" : v === "en" ? "en" : config.defaultLocale);
