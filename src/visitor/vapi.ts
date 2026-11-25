import { getLang } from "../i18n";
export interface Info {
  status: "ok" | "invalid";
  title?: string;
  step?: "identity" | "nda" | "read";
  require_email?: boolean;
  require_otp?: boolean;
  require_password?: boolean;
  visitor?: { name: string | null; email: string | null } | null;
}

export interface OpenData {
  visit_id: string;
  title: string;
  version_label: string;
  page_count: number;
  name: string | null;
  email: string | null;
  watermark: string | null;
  allow_download: boolean;
}

export interface Reply<T> {
  ok: boolean;
  status: number;
  data: T & { code?: string; error?: string };
}

export async function call<T = Record<string, unknown>>(slug: string, path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const payload = body !== null && typeof body === "object" ? { lang: getLang(), ...(body as object) } : body;
    const res = await fetch(`/api/v/${slug}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(payload),
    });
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : {};
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { code: "network" } as Reply<T>["data"] };
  }
}

// The reader's `open` call is started in parallel with the first `info` call, saving a full round trip on first load.
// It only succeeds when the session is already valid, so it is harmless at the identity / NDA steps.
const prefetched = new Map<string, Promise<Reply<OpenData>>>();
export const prefetchOpen = (slug: string) => { prefetched.set(slug, call<OpenData>(slug, "open", {})); };
export const takePrefetchedOpen = (slug: string) => { const p = prefetched.get(slug); prefetched.delete(slug); return p; };

export const imageUrl = (slug: string, kind: "pages" | "thumbs", visit: string, n: number) =>
  `/api/v/${slug}/${kind}/${visit}/${n}`;
