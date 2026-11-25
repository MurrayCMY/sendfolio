import { useEffect, useState } from "preact/hooks";
import { api, Overview as OverviewData, VisitRow } from "../api";
import { Link } from "../app";
import { tzFormat, fmtDur, fmtRelative, fmtTime, intentReason, visitorStatus } from "../format";
import { IconAlert, IconCheck, IconClock, IconEye, IconInbox, IconLink, IconMail, IconPulse, IconTrending, IconUsers } from "../ui/icons";
import { Card, PageHeader, Spark, StatCard } from "../ui/kit";
import { VisitTable } from "./VisitTable";
import { t } from "../i18n";

/** The last 14 days in the server time zone, oldest first, with zeros where nothing happened. */
function series(daily: { day: string; n: number }[]): number[] {
  const byDay = new Map(daily.map((d) => [d.day, d.n]));
  return Array.from({ length: 14 }, (_, i) => byDay.get(tzFormat({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - (13 - i) * 864e5))) ?? 0);
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [recent, setRecent] = useState<VisitRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      api.overview().then(setData).catch((e) => setError(e.message));
      api.recentVisits().then((r) => setRecent(r.visits)).catch(() => setRecent([]));
    };
    load();
    const id = setInterval(load, 30000); // keeps the "reading now" marker fresh while the page is open
    return () => clearInterval(id);
  }, []);

  const k = data?.kpi;
  const delta = k && k.visits_prev_7d > 0 ? (k.visits_7d - k.visits_prev_7d) / k.visits_prev_7d : null;
  const attention: { text: any }[] = [];
  if (data?.pending_nda_emails) attention.push({ text: <>{t("{0} NDA confirmation emails have not been sent yet. They are retried every 10 minutes.", data.pending_nda_emails)}<Link href="/admin/settings">{t("View")}</Link></> });
  for (const l of data?.expiring ?? []) attention.push({ text: <>{t("The link “")}<Link href={`/admin/documents/${l.document_id}?tab=links`}>{l.name}</Link>{t("” expires on {0}.", fmtTime(l.expires_at))}</> });
  const live = (recent ?? []).filter((v) => v.last_heartbeat_at && Date.now() - new Date(v.last_heartbeat_at).getTime() < 45000).length;

  return (
    <>
      <PageHeader title={t("Overview")} subtitle={t("Reading activity over the last 7 days. Times are in the server time zone.")} />
      {error && <p class="field-error" role="alert">{error}</p>}

      {attention.length > 0 && (
        <div class="attn" role="region" aria-label={t("Needs attention")}>
          {attention.map((a, i) => <div class="item" key={i}><IconAlert size={16} /><span>{a.text}</span></div>)}
        </div>
      )}

      <div class="stats">
        <StatCard icon={<IconEye size={15} />} label={t("Visits · last 7 days")} value={k ? k.visits_7d : "—"} delta={delta} hint={delta === null ? t("No data last week") : t("vs last week")}>
          {data && <Spark data={series(data.daily)} label={t("Visits per day over the last 14 days")} />}
        </StatCard>
        <StatCard icon={<IconUsers size={15} />} label={t("Visitors · last 7 days")} value={k ? k.visitors_7d : "—"} hint={k ? t("{0} new NDA signatures", k.nda_7d) : undefined} />
        <StatCard icon={<IconClock size={15} />} label={t("Average active reading")} value={k ? (k.avg_ms_7d ? fmtDur(k.avg_ms_7d) : "—") : "—"} hint={t("per visit")} />
        <StatCard icon={<IconLink size={15} />} label={t("Active links")} value={k ? k.active_links : "—"} hint={k ? t("{0} documents", k.documents) : undefined} />
      </div>

      <div class="grid-even">
        <Card title={t("Worth following up")} icon={<IconTrending size={17} />} pad={false}
          action={<Link href="/admin/visitors" class="btn btn-ghost btn-sm">{t("All visitors")}</Link>}>
          {data === null ? <><div class="skel-row" /><div class="skel-row" /></> : data.followups.length === 0 ? (
            <div class="calm"><IconCheck size={18} /><span>{t("Nobody came back or read deeply in the last 7 days. They will show up here when they do.")}</span></div>
          ) : (
            <ul class="signal-list">
              {data.followups.map((f) => (
                <li key={f.id}>
                  <span class={`sig-icon ${f.visits >= 2 && f.depth >= 0.6 ? "hot" : ""}`}><IconTrending size={17} /></span>
                  <span class="sig-main"><Link href={`/admin/visitors/${f.id}`}><b>{f.name}</b></Link><span>{intentReason(f)}</span></span>
                  <span class="sig-side">{visitorStatus(f.status).label}<br />{fmtRelative(f.last_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("Links nobody has opened")} icon={<IconInbox size={17} />} pad={false}>
          {data === null ? <><div class="skel-row" /><div class="skel-row" /></> : data.unopened.length === 0 ? (
            <div class="calm"><IconCheck size={18} /><span>{t("Every link older than 3 days has been opened.")}</span></div>
          ) : (
            <ul class="signal-list">
              {data.unopened.map((l) => (
                <li key={l.id}>
                  <span class="sig-icon"><IconLink size={17} /></span>
                  <span class="sig-main"><Link href={`/admin/documents/${l.document_id}?tab=links`}><b>{l.name}</b></Link><span>{l.title}</span></span>
                  <span class="sig-side">{t("Created on")}<br />{fmtRelative(l.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title={t("Recent activity")}
        icon={<IconPulse size={17} />}
        action={<>{live > 0 && <span class="live" style={{ marginRight: "14px", fontSize: "13px" }}>{t("● {0} reading now", live)}</span>}<Link href="/admin/visitors" class="btn btn-ghost btn-sm">{t("All visitors")}</Link></>}
        pad={false}
      >
        {recent === null ? <><div class="skel-row" /><div class="skel-row" /><div class="skel-row" /></> : (
          <VisitTable visits={recent.slice(0, 12)} show={{ who: true, linkDoc: true }} />
        )}
      </Card>
    </>
  );
}
