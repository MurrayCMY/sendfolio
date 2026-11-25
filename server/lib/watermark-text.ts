import { config } from "./config";
export type WatermarkField = "name" | "email" | "ip" | "date" | "datetime";
export const WATERMARK_FIELDS: WatermarkField[] = ["name", "email", "ip", "date", "datetime"];

const day = new Intl.DateTimeFormat("sv-SE", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
const minute = new Intl.DateTimeFormat("sv-SE", {
  timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function cleanFields(v: unknown): WatermarkField[] {
  const list = Array.isArray(v) ? v : [];
  return WATERMARK_FIELDS.filter((f) => list.includes(f));
}

/**
 * The text printed on every page (and on the downloaded PDF): optional fixed text first, then the chosen
 * visitor fields. Time uses the configured TIMEZONE. If a field has no value (anonymous visitor) it is skipped.
 */
export function buildWatermark(
  link: { watermark: boolean; watermark_fields: string[] | null; watermark_text: string | null },
  who: { name: string | null; email: string | null; ip: string | null },
  when: Date,
): string | null {
  if (!link.watermark) return null;
  const f = new Set(link.watermark_fields ?? ["email", "date"]);
  const parts: string[] = [];
  if (link.watermark_text?.trim()) parts.push(link.watermark_text.trim());
  if (f.has("name") && who.name) parts.push(who.name);
  if (f.has("email") && who.email) parts.push(who.email);
  if (f.has("ip") && who.ip) parts.push(who.ip);
  if (f.has("datetime")) parts.push(minute.format(when));
  else if (f.has("date")) parts.push(day.format(when));
  return parts.join(" · ") || "Confidential";
}
