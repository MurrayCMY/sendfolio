import { db } from "./db";
import { deviceName, openAlertMail, summaryMail } from "./emails";
import { sendMail } from "./mail";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const siteUrl = () => (process.env.SITE_URL ?? "").replace(/\/$/, "");
const adminEmail = () => (process.env.ADMIN_EMAIL ?? "").trim();

/**
 * Open alert for a brand-new visit. At most one per person per link per hour, and only when the link asks for it.
 * Never throws: a failed alert must not break reading.
 */
export async function notifyOpen(visitId: string): Promise<void> {
  try {
    const to = adminEmail();
    if (!to) return;
    const [v] = await db.sql<Row>`
      select v.id, v.link_id, v.visitor_id, v.started_at, v.device, v.in_wechat, v.geo_city, v.geo_country,
             vis.name, vis.email, l.name as link_name, l.notify_on_open, l.document_id, d.title, dv.version_label
      from visits v
      join links l on l.id = v.link_id
      join documents d on d.id = l.document_id
      join document_versions dv on dv.id = v.version_id
      left join visitors vis on vis.id = v.visitor_id
      where v.id = ${visitId}`;
    if (!v || !v.notify_on_open) return;

    const [recent] = await db.sql`
      select 1 as ok from visits
      where link_id = ${v.link_id} and visitor_id is not distinct from ${v.visitor_id}::uuid
        and id <> ${v.id} and open_notified_at > now() - interval '1 hour' limit 1`;
    if (recent) return;
    const [claimed] = await db.sql`update visits set open_notified_at = now() where id = ${v.id} and open_notified_at is null returning id`;
    if (!claimed) return;

    const [no] = await db.sql<{ n: number }>`
      select count(*)::int as n from visits x join links lx on lx.id = x.link_id
      where lx.document_id = ${v.document_id} and x.visitor_id is not distinct from ${v.visitor_id}::uuid`;
    await sendMail({
      to,
      ...openAlertMail({
        name: v.name ?? "Anonymous visitor",
        email: v.email ?? "No email on file",
        doc_title: v.title,
        version_label: v.version_label,
        link_name: v.link_name,
        started_at: v.started_at,
        geo: [v.geo_city, v.geo_country].filter(Boolean).join(" · ") || "Unknown",
        device: deviceName(v.device, v.in_wechat),
        visit_no: no.n,
        admin_url: `${siteUrl()}/admin/visits/${v.id}`,
      }),
    });
  } catch (e) {
    console.error("open alert failed", e);
  }
}

/**
 * Sends one reading summary. A visit has ended once 15 minutes pass without a heartbeat (the caller selects those).
 * Per person per link at most one summary per hour; later ones are marked handled without sending.
 */
export async function sendSummary(visitId: string): Promise<"sent" | "skipped" | "gone"> {
  const to = adminEmail();
  const [v] = await db.sql<Row>`
    select v.id, v.link_id, v.visitor_id, v.started_at, v.total_active_ms, v.max_page, vis.name, vis.email,
           l.name as link_name, l.document_id, d.title, dv.page_count
    from visits v
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    where v.id = ${visitId} and v.summary_sent_at is null`;
  if (!v) return "gone";

  const [recent] = await db.sql`
    select 1 as ok from visits
    where link_id = ${v.link_id} and visitor_id is not distinct from ${v.visitor_id}::uuid
      and id <> ${v.id} and summary_emailed and summary_sent_at > now() - interval '1 hour' limit 1`;
  if (recent || !to) {
    await db.sql`update visits set summary_sent_at = now() where id = ${v.id}`;
    return "skipped";
  }

  const [counts] = await db.sql<{ viewed: number }>`select count(*)::int as viewed from page_views where visit_id = ${v.id}`;
  const top = await db.sql<{ page: number; active_ms: number }>`
    select page, active_ms from page_views where visit_id = ${v.id} and active_ms >= 1000 order by active_ms desc, page limit 5`;
  const [seq] = await db.sql<{ visit_no: number; total_ms: string }>`
    select count(*) filter (where x.started_at <= ${v.started_at})::int as visit_no,
           coalesce(sum(x.total_active_ms), 0)::bigint as total_ms
    from visits x join links lx on lx.id = x.link_id
    where lx.document_id = ${v.document_id} and x.visitor_id is not distinct from ${v.visitor_id}::uuid`;

  await sendMail({
    to,
    ...summaryMail({
      name: v.name ?? "Anonymous visitor",
      email: v.email ?? "No email on file",
      doc_title: v.title,
      link_name: v.link_name,
      started_at: v.started_at,
      duration_ms: Number(v.total_active_ms),
      pages_viewed: counts.viewed,
      max_page: v.max_page,
      page_count: v.page_count,
      visit_no: seq.visit_no,
      total_duration_ms: Number(seq.total_ms),
      top_pages: top.map((t) => ({ page: t.page, seconds: Math.round(Number(t.active_ms) / 1000) })),
      admin_url: `${siteUrl()}/admin/visits/${v.id}`,
    }),
  });
  await db.sql`update visits set summary_sent_at = now(), summary_emailed = true where id = ${v.id}`;
  return "sent";
}
