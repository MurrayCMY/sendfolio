import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Link, navigate } from "../app";
import { deviceLabel, fmtDur, fmtTime, geoLabel } from "../format";
import { IconArrowLeft, IconClock, IconEye, IconPulse, IconTrash } from "../ui/icons";
import { Card, PageHeader, toast, Menu } from "../ui/kit";
import { BarChart } from "./BarChart";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../i18n";

type Data = Awaited<ReturnType<typeof api.visitDetail>>;

export function VisitDetail({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.visitDetail(id).then(setData).catch((e) => setError(e.message)); }, [id]);

  if (error) return <p class="field-error" role="alert">{error}</p>;
  if (!data) return <div class="panel"><div class="skel-row" /><div class="skel-row" /></div>;
  const { visit: v, pages, timeline } = data;
  const end = v.last_heartbeat_at ?? v.started_at;
  const viewed = pages.filter((p) => p.active_ms > 0 || timeline.some((x) => x.page === p.page)).length;

  return (
    <>
      <PageHeader
        back={<Link href={`/admin/links/${v.link_id}`}><IconArrowLeft size={15} /> {v.link_name}</Link>}
        title={v.visitor_id ? <Link href={`/admin/visitors/${v.visitor_id}`}>{v.visitor_name ?? t("Anonymous visit")}</Link> : (v.visitor_name ?? t("Anonymous visit"))}
        subtitle={v.visitor_email ?? undefined}
        actions={<Menu label={t("More actions")} items={[{ label: t("Delete this record…"), icon: <IconTrash size={16} />, danger: true, onClick: () => setConfirming(true) }]} />}
      />
      <Card title={t("This visit")} icon={<IconEye size={17} />}>
        <dl class="facts">
          <div><dt>{t("Document")}</dt><dd>{t("{0} ({1})", v.title, v.version_label)}</dd></div>
          <div><dt>{t("Started")}</dt><dd class="tnum">{fmtTime(v.started_at)}</dd></div>
          <div><dt>{t("Last activity")}</dt><dd class="tnum">{fmtTime(end)}</dd></div>
          <div><dt>{t("Active reading")}</dt><dd class="tnum">{fmtDur(v.total_active_ms)}</dd></div>
          <div><dt>{t("Pages viewed")}</dt><dd class="tnum">{t("{0} / {1}, furthest page {2}", viewed, v.page_count, v.max_page)}</dd></div>
          <div><dt>{t("Device")}</dt><dd>{deviceLabel(v.device, v.in_wechat)}</dd></div>
          <div><dt>{t("Location")}</dt><dd>{geoLabel(v.geo_city, v.geo_country)}</dd></div>
          <div><dt>IP</dt><dd class="mono">{v.ip ?? "—"}</dd></div>
        </dl>
      </Card>
      <Card title={t("Time per page")} icon={<IconClock size={17} />}>
        <BarChart versionId={v.version_id} bars={pages.map((p) => ({ page: p.page, ms: p.active_ms }))} caption={t("Only counts time when the page is visible, the window is focused and there was activity in the last 30 seconds.")} />
      </Card>
      <Card title={t("Timeline")} icon={<IconPulse size={17} />}>
        <ol class="timeline">
          <li><time>{fmtTime(v.started_at)}</time>{" "}{t("Opened the reader")}</li>
          {timeline.map((step) => (
            <li key={step.page}><time>{fmtTime(step.at)}</time>{" "}{t("First reached page {0}", step.page)}<span class="muted">{t(" ({0} on that page)", fmtDur(step.active_ms))}</span></li>
          ))}
          <li><time>{fmtTime(end)}</time>{" "}{t("Last heartbeat")}</li>
        </ol>
      </Card>
      {confirming && (
        <ConfirmDialog
          title={t("Delete this visit record?")}
          body={t("This permanently deletes the visit and its per-page reading times and cannot be undone. The visitor's NDA signing records are not affected.")}
          confirmLabel={t("Permanently delete")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.deleteVisits([id]); toast(t("Visit record deleted")); navigate(`/admin/links/${v.link_id}`); }
            catch (e) { toast((e as Error).message, "bad"); setBusy(false); setConfirming(false); }
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
