import { useState } from "preact/hooks";
import { VisitRow } from "../api";
import { deviceLabel, fmtDur, fmtRelative, fmtTime, geoShort } from "../format";
import { Link } from "../app";
import { EmptyState, toast } from "../ui/kit";
import { IconEye, IconTrash } from "../ui/icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../i18n";

const isLive = (v: VisitRow) => !!v.last_heartbeat_at && Date.now() - new Date(v.last_heartbeat_at).getTime() < 45000;

/**
 * Visit list used on the overview, document, link and visitor pages.
 * With `onDelete`, rows get checkboxes and the admin can permanently delete the selected visit records.
 */
export function VisitTable({
  visits,
  show,
  onDelete,
  embedded,
}: {
  visits: VisitRow[];
  show: { who?: boolean; doc?: boolean; link?: boolean; version?: boolean; linkDoc?: boolean };
  onDelete?: (ids: string[]) => Promise<void>;
  embedded?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (visits.length === 0) {
    return <EmptyState icon={<IconEye />} title={t("No visits yet")} body={t("Once someone opens a link, their reading shows up here.")} />;
  }
  const allSelected = visits.every((v) => selected.has(v.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function doDelete() {
    if (!onDelete) return;
    setBusy(true);
    try {
      const count = selected.size;
      await onDelete([...selected]);
      setSelected(new Set());
      toast(t("{0} visit records deleted", count));
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    setConfirming(false);
    setBusy(false);
  }

  return (
    <>
      {onDelete && selected.size > 0 && (
        <div class="bulkbar">
          <b>{t("{0} selected", selected.size)}</b>
          <button class="btn btn-danger btn-sm" onClick={() => setConfirming(true)}><IconTrash size={15} />{" "}{t("Delete selected records")}</button>
          <button class="btn-link" onClick={() => setSelected(new Set())}>{t("Clear selection")}</button>
        </div>
      )}
      <div class="table-wrap">
        <table class="dtable">
          <thead>
            <tr>
              {onDelete && (
                <th class="chk">
                  <input type="checkbox" aria-label={t("Select all")} checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(visits.map((v) => v.id)))} />
                </th>
              )}
              {show.who && <th>{t("Visitors")}</th>}
              {show.doc && <th>{t("Documents")}</th>}
              {show.link && <th>{t("Links")}</th>}
              {show.linkDoc && <th>{t("Link / document")}</th>}
              {show.version && <th>{t("Version")}</th>}
              <th>{t("Time")}</th>
              <th class="right">{t("Active reading")}</th>
              <th>{t("Reached")}</th>
              <th>{t("Device / location")}</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} class={selected.has(v.id) ? "picked" : ""}>
                {onDelete && (
                  <td class="chk">
                    <input type="checkbox" aria-label={t("Select the visit from {0}", fmtTime(v.started_at))} checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                  </td>
                )}
                {show.who && (
                  <td>
                    {v.visitor_id ? <Link href={`/admin/visitors/${v.visitor_id}`}>{v.visitor_name}</Link> : <b>{t("Anonymous visitor")}</b>}
                    <span class="cell-sub">{v.visitor_email ?? t("No email on file")}</span>
                  </td>
                )}
                {show.doc && <td class="clip"><span class="ell" title={v.title}>{v.title}</span><span class="cell-sub">{v.version_label}</span></td>}
                {show.link && <td>{v.link_id ? <Link href={`/admin/links/${v.link_id}`}>{v.link_name}</Link> : ""}</td>}
                {show.linkDoc && (
                  <td class="clip">
                    {v.link_id ? <Link href={`/admin/links/${v.link_id}`}>{v.link_name}</Link> : <b>{t("Deleted link")}</b>}
                    <span class="cell-sub">{v.title} · {v.version_label}</span>
                  </td>
                )}
                {show.version && <td>{v.version_label}</td>}
                <td class="nw">
                  <Link href={`/admin/visits/${v.id}`} title={fmtTime(v.started_at)}>{fmtRelative(v.started_at)}</Link>
                  <span class="cell-sub tnum">{isLive(v) ? <span class="live">{t("● Reading now")}</span> : fmtTime(v.started_at).slice(5)}</span>
                </td>
                <td class="right tnum nw"><b>{fmtDur(v.total_active_ms)}</b></td>
                <td class="tnum nw">{v.max_page} / {v.page_count}</td>
                <td class="nw">
                  {deviceLabel(v.device, v.in_wechat)}
                  <span class="cell-sub" title={[v.geo_city, v.geo_country].filter(Boolean).join(", ")}>{geoShort(v.geo_city, v.geo_country)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t("Delete {0} visit records?", selected.size)}
          body={t("This permanently deletes these visits and their per-page reading times and cannot be undone. NDA signing records are not affected; heat maps and statistics are recalculated.")}
          confirmLabel={t("Permanently delete")}
          danger
          busy={busy}
          onConfirm={doDelete}
          onClose={() => setConfirming(false)}
        />
      )}
      {embedded && null}
    </>
  );
}
