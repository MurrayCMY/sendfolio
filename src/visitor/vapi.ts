import { getLang } from "../i18n";
export interface Info {
  status: "ok" | "invalid";
  title?: string;
  page_count?: number | null;
  is_room?: boolean;
  room_description?: string | null;
  doc_count?: number | null;
  step?: "identity" | "nda" | "read";
  preview?: boolean;
  require_email?: boolean;
  require_otp?: boolean;
  require_password?: boolean;
  require_nda?: boolean;
  visitor?: { name: string | null; email: string | null } | null;
}

export interface RoomDoc {
  id: string;
  title: string;
  section: string | null;
  version_id: string;
  version_label: string;
  page_count: number;
}

export interface RoomData {
  title: string;
  description: string | null;
  preview?: boolean;
  documents: RoomDoc[];
}

export interface OpenData {
  visit_id: string;
  preview?: boolean;
  document_id?: string;
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

const isPreviewMode = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("preview") === "1";

export async function call<T = Record<string, unknown>>(slug: string, path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const payload = body !== null && typeof body === "object" ? { lang: getLang(), ...(body as object) } : body;
    const qs = isPreviewMode() ? "?preview=1" : "";
    const res = await fetch(`/api/v/${slug}/${path}${qs}`, {
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

export const imageUrl = (slug: string, kind: "pages" | "thumbs", visit: string, n: number, docId?: string) => {
  const params = new URLSearchParams();
  if (visit === "preview") params.set("preview", "1");
  if (visit === "preview" && docId) params.set("doc", docId);
  const qs = params.size ? `?${params}` : "";
  return `/api/v/${slug}/${kind}/${visit}/${n}${qs}`;
};

export const roomThumbUrl = (slug: string, docId: string) =>
  `/api/v/${slug}/room-thumb/${docId}${isPreviewMode() ? "?preview=1" : ""}`;
