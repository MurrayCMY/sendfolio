import { t } from "./i18n";
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { credentials: "same-origin", ...init });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (res.status === 401 && !path.startsWith("auth/")) window.dispatchEvent(new Event("admin-unauthorized"));
  if (!res.ok) throw new ApiError(res.status, data?.error ? t(String(data.error)) : t("Request failed ({0})", res.status));
  return data as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export interface DocRow {
  id: string;
  title: string;
  note: string | null;
  archived_at: string | null;
  created_at: string;
  version_id: string | null;
  version_label: string | null;
  page_count: number | null;
  link_count: number;
  visit_count: number;
  last_visit_at: string | null;
}
export interface VersionRow {
  id: string;
  version_label: string;
  page_count: number;
  created_at: string;
}

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
  has_password: boolean;
  allow_download: boolean;
  watermark: boolean;
  notify_on_open: boolean;
  watermark_fields: string[] | null;
  watermark_text: string | null;
  created_at: string;
  visitor_count: number;
  visit_count: number;
  last_visit_at: string | null;
}
export type LinkInput = Partial<Omit<LinkRow, "id" | "document_id" | "has_password" | "created_at" | "visitor_count" | "visit_count" | "last_visit_at">> & {
  slug?: string;
  password?: string;
  clear_password?: boolean;
};
export interface Overview {
  kpi: { visits_7d: number; visits_prev_7d: number; visitors_7d: number; avg_ms_7d: number; active_links: number; documents: number; nda_7d: number };
  daily: { day: string; n: number }[];
  expiring: { id: string; name: string; expires_at: string; document_id: string; title: string }[];
  pending_nda_emails: number;
  followups: { id: string; name: string; email: string; status: string | null; visits: number; total_ms: number; last_at: string; depth: number }[];
  unopened: { id: string; name: string; created_at: string; document_id: string; title: string }[];
}
export interface NdaListRow {
  id: string;
  label: string;
  sha256: string;
  active: boolean;
  created_at: string;
}
export interface NdaFull extends NdaListRow {
  body_zh: string;
  body_en: string;
}

export interface VisitRow {
  id: string;
  started_at: string;
  last_heartbeat_at: string | null;
  total_active_ms: number;
  max_page: number;
  device: string | null;
  in_wechat: boolean | null;
  geo_city: string | null;
  geo_country: string | null;
  visitor_id?: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  link_id?: string;
  link_name?: string;
  document_id?: string;
  title?: string;
  version_label: string;
  page_count: number;
}
export interface DocStats {
  version: { id: string; version_label: string; page_count: number } | null;
  visits: number;
  visitors: number;
  pages: { page: number; avg_ms: number; viewers: number; reach: number }[];
}
export interface VisitorSummary {
  id: string;
  name: string;
  email: string;
  visits: number;
  documents?: number;
  links?: number;
  total_ms: number;
  last_at: string | null;
  nda_signed: boolean;
  status?: string | null;
  note?: string | null;
  depth?: number;
  docs?: string[];
}
export interface Acceptance {
  id: string;
  visitor_id: string | null;
  name_as_entered: string;
  email: string;
  ip: string | null;
  accepted_at: string;
  email_sent_at: string | null;
  nda_label: string;
  link_name: string;
  title: string;
}

const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  recentVisits: () => request<{ visits: VisitRow[] }>("dashboard"),
  docStats: (docId: string, versionId?: string, linkId?: string) => {
    const q = new URLSearchParams();
    if (versionId) q.set("version", versionId);
    if (linkId) q.set("link", linkId);
    return request<DocStats>(`documents/${docId}/stats${q.size ? `?${q}` : ""}`);
  },
  docVisits: (docId: string, linkId?: string) =>
    request<{ visits: VisitRow[] }>(`documents/${docId}/visits${linkId ? `?link=${linkId}` : ""}`),
  linkDetail: (id: string) =>
    request<{
      link: { id: string; name: string; slug: string; enabled: boolean; expires_at: string | null; document_id: string; title: string };
      visitors: VisitorSummary[];
      visits: VisitRow[];
    }>(`links/${id}`),
  visitDetail: (id: string) =>
    request<{
      visit: VisitRow & { user_agent: string | null; ip: string | null; version_id: string };
      pages: { page: number; active_ms: number }[];
      timeline: { page: number; at: string; active_ms: number }[];
    }>(`visits/${id}`),
  visitors: () => request<{ visitors: VisitorSummary[] }>("visitors"),
  visitor: (id: string) =>
    request<{
      visitor: { id: string; name: string; email: string; first_seen_at: string; status: string | null; note: string | null };
      visits: VisitRow[];
      acceptances: { id: string; accepted_at: string; nda_label: string; link_name: string }[];
    }>(`visitors/${id}`),
  updateVisitor: (id: string, patch: { status?: string; note?: string }) => request<{ ok: true }>(`visitors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }),
  acceptances: () => request<{ acceptances: Acceptance[] }>("nda-acceptances"),
  resendNdaEmail: (id: string) => post<{ ok: true }>(`nda-acceptances/${id}/resend`),
  ndaPdfUrl: (id: string) => `/api/admin/nda-acceptances/${id}/pdf`,
  links: (docId: string) => request<{ links: LinkRow[] }>(`documents/${docId}/links`),
  createLink: (docId: string, input: LinkInput) => post<{ id: string; slug: string }>(`documents/${docId}/links`, input),
  updateLink: (id: string, input: LinkInput) => patch<{ ok: true }>(`links/${id}`, input),
  ndaVersions: () => request<{ versions: NdaListRow[] }>("nda"),
  ndaVersion: (id: string) => request<NdaFull>(`nda/${id}`),
  createNda: (label: string, body_zh: string, body_en: string) => post<{ id: string }>("nda", { label, body_zh, body_en }),
  activateNda: (id: string) => post(`nda/${id}/activate`),
  settings: () => request<{ personal_email_domains: string[] }>("settings"),
  savePersonalDomains: (domains: string[]) => put<{ ok: true }>("settings/personal-domains", { domains }),
  overview: () => request<Overview>("overview"),
  deleteLink: (id: string) => request<{ deleted: boolean; visits_deleted: number }>(`links/${id}`, { method: "DELETE" }),
  deleteVisitor: (id: string) => request<{ deleted: boolean; visits_deleted: number; acceptances_deleted: number }>(`visitors/${id}`, { method: "DELETE" }),
  updateDocument: (id: string, title: string, note: string) => patch<{ ok: true }>(`documents/${id}`, { title, note }),
  deleteVisits: (ids: string[]) => post<{ deleted: number }>("visits/delete", { ids }),
  mailCheck: (selector?: string) =>
    request<{
      domain: string;
      mx: string[];
      spf: string[];
      dmarc: string[];
      dkim: { selector: string; records: string[] } | null;
      docs: { host: string; cname: string[] };
      notes: string[];
    }>(`mail-check${selector ? `?selector=${encodeURIComponent(selector)}` : ""}`),
  mailTest: (to: string[]) => post<{ results: { to: string; ok: boolean; error?: string }[] }>("mail-test", { to }),
  me: () => request<{ admin: boolean }>("auth/me"),
  requestCode: (email: string) => post<{ ok: true }>("auth/request", { email }),
  verifyCode: (email: string, code: string) => post<{ ok: true }>("auth/verify", { email, code }),
  logout: () => post("auth/logout"),
  documents: () => request<{ documents: DocRow[] }>("documents"),
  document: (id: string) =>
    request<{ document: Omit<DocRow, "version_id" | "version_label" | "page_count" | "link_count" | "visit_count" | "last_visit_at">; versions: VersionRow[] }>(
      `documents/${id}`,
    ),
  createDocument: (title: string, note: string) => post<{ id: string }>("documents", { title, note }),
  createVersion: (docId: string, version_label: string, page_count: number) =>
    post<{ id: string }>(`documents/${docId}/versions`, { version_label, page_count }),
  archive: (id: string) => post(`documents/${id}/archive`),
  putBinary: (path: string, body: Blob | ArrayBuffer, contentType: string) =>
    request<{ ok: true }>(path, { method: "PUT", headers: { "content-type": contentType }, body }),
  completePdf: (vid: string, parts: number) => post(`versions/${vid}/pdf/complete`, { parts }),
  finalize: (vid: string) => post(`versions/${vid}/finalize`),
  thumbUrl: (vid: string, n: number) => `/api/admin/versions/${vid}/thumbs/${n}`,
  pageUrl: (vid: string, n: number) => `/api/admin/versions/${vid}/pages/${n}`,
};
