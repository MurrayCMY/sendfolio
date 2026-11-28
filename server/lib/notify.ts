import { db } from "./db";
import { deviceName, openAlertMail, summaryMail } from "./emails";
import { sendMail } from "./mail";
import { deliverWebhooks, getAllAdminEmails } from "./settings";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const siteUrl = () => (process.env.SITE_URL ?? "").replace(/\/$/, "");

/**
 * Open alert for a brand-new visit. At most one per person per link per hour, and only when the link asks for it.
 * Detects link forwarding (when a second distinct visitor opens a personal link) and delivers email + webhooks.
 * Never throws: a failed alert must not break reading.
 */
export async function notifyOpen(visitId: string): Promise<void> {
  try {
    const admins = await getAllAdminEmails();
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
    const [fwd] = await db.sql<{ other: number }>`
      select count(distinct visitor_id)::int as other from visits
      where link_id = ${v.link_id} and visitor_id is not null and visitor_id is distinct from ${v.visitor_id}::uuid`;
    const forwarded = !!v.visitor_id && fwd.other > 0;

    const adminUrl = `${siteUrl()}/admin/visits/${v.id}`;
    const name = v.name ?? "Anonymous visitor";
    const email = v.email ?? "No email on file";
    const geo = [v.geo_city, v.geo_country].filter(Boolean).join(" · ") || "Unknown";
    const device = deviceName(v.device, v.in_wechat);

    if (admins.length) {
      const mail = openAlertMail({
        name: forwarded ? `${name} [Forwarded]` : name,
        email,
        doc_title: v.title,
        version_label: v.version_label,
        link_name: v.link_name,
        started_at: v.started_at,
        geo,
        device,
        visit_no: no.n,
        admin_url: adminUrl,
      });
      await Promise.allSettled(admins.map((to) => sendMail({ to, ...mail })));
    }

    await deliverWebhooks({
      event: "open",
      forwarded,
      title: forwarded ? `Forwarded link opened: ${v.title}` : `${name} opened ${v.title}`,
      body: `${name} (${email}) opened "${v.title}" via link "${v.link_name}"${forwarded ? " — possible forward (another person previously opened this link)" : ""}.\nDevice: ${device} · Location: ${geo}`,
      admin_url: adminUrl,
      meta: { visit_id: v.id, link_id: v.link_id, link_name: v.link_name, document_id: v.document_id, doc_title: v.title, visitor_name: name, visitor_email: v.email ?? null, visit_no: no.n },
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
  const admins = await getAllAdminEmails();
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
  if (recent || !admins.length) {
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

  const adminUrl = `${siteUrl()}/admin/visits/${v.id}`;
  const name = v.name ?? "Anonymous visitor";
  const email = v.email ?? "No email on file";
  const mail = summaryMail({
    name,
    email,
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
    admin_url: adminUrl,
  });
  await Promise.allSettled(admins.map((to) => sendMail({ to, ...mail })));
  const secs = Math.round(Number(v.total_active_ms) / 1000);
  const topStr = top.slice(0, 3).map((t) => `p.${t.page} (${Math.round(Number(t.active_ms) / 1000)}s)`).join(", ");
  await deliverWebhooks({
    event: "summary",
    title: `Reading summary: ${name} · ${v.title}`,
    body: `${name} (${email}) spent ${secs}s across ${counts.viewed}/${v.page_count} pages (reached p.${v.max_page}).${topStr ? `\nTop pages: ${topStr}` : ""}`,
    admin_url: adminUrl,
    meta: { visit_id: v.id, link_id: v.link_id, document_id: v.document_id, duration_ms: Number(v.total_active_ms), pages_viewed: counts.viewed, max_page: v.max_page, page_count: v.page_count },
  });
  await db.sql`update visits set summary_sent_at = now(), summary_emailed = true where id = ${v.id}`;
  return "sent";
}
