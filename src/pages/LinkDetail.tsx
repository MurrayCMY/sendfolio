import { useEffect, useId, useState } from "preact/hooks";
import { api, LinkRow, VersionRow } from "../api";
import { Link, navigate } from "../app";
import { fmtDur, fmtRelative, linkStatus, linkUrl } from "../format";
import { IconArrowLeft, IconCopy, IconEdit, IconTrash } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { Avatar, Badge, Card, PageHeader, StatCard, toast } from "../ui/kit";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkDialog } from "./LinkDialog";
import { VisitTable } from "./VisitTable";
import { copyLink } from "./Links";
import { t } from "../i18n";

type Data = Awaited<ReturnType<typeof api.linkDetail>>;

export function LinkDetail({ id }: { id: string }) {
  const uid = useId();
  const [data, setData] = useState<Data | null>(null);
  const [full, setFull] = useState<LinkRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  useEffect(() => {
    api.linkDetail(id).then((d) => {
      setData(d);
      api.links(d.link.document_id).then((r) => setFull(r.links.find((l) => l.id === id) ?? null));
      api.document(d.link.document_id).then((r) => setVersions(r.versions));
    }).catch((e) => setError(e.message));
  }, [id, reloadKey]);

  if (error) return <p class="field-error" role="alert">{error}</p>;
  if (!data) return <div class="panel"><div class="skel-row" /><div class="skel-row" /></div>;
  const { link, visitors, visits } = data;
  const st = linkStatus(link);
  const total = visits.reduce((a, v) => a + v.total_active_ms, 0);

  return (
    <>
      <PageHeader
        back={<Link href={`/admin/documents/${link.document_id}?tab=links`}><IconArrowLeft size={15} /> {link.title}</Link>}
        title={link.name}
        meta={<><Badge tone={st.tone}>{st.text}</Badge><span class="url-pill"><span class="mono">{linkUrl(link.slug)}</span>
          <button class="icon-btn" aria-label={t("Copy link")} onClick={() => copyLink(link.slug, setManualUrl)}><IconCopy size={14} /></button></span></>}
        actions={<>
          <button class="btn" disabled={!full} onClick={() => setEditing(true)}><IconEdit size={16} />{" "}{t("Edit")}</button>
          <button class="btn btn-danger" onClick={() => setDeleting(true)}><IconTrash size={16} />{" "}{t("Delete")}</button>
        </>}
      />
      <div class="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <StatCard label={t("Visitors")} value={visitors.length} />
        <StatCard label={t("Visits")} value={visits.length} />
        <StatCard label={t("Total active reading")} value={total ? fmtDur(total) : "—"} />
      </div>

      <Card title={t("Visitors")} pad={false}>
        {visitors.length === 0 ? <p class="muted" style={{ padding: "16px 20px", margin: 0 }}>{t("Nobody has read through this link yet.")}</p> : (
          <div class="table-wrap"><table class="dtable">
            <thead><tr><th>{t("Visitors")}</th><th class="right">{t("Visits")}</th><th class="right">{t("Total time")}</th><th>{t("Last visit")}</th><th>NDA</th></tr></thead>
            <tbody>
              {visitors.map((v) => (
                <tr key={v.id}>
                  <td><div class="cell-main"><Avatar name={v.name} /><span><Link href={`/admin/visitors/${v.id}`}>{v.name}</Link><span class="cell-sub">{v.email}</span></span></div></td>
                  <td class="right tnum">{v.visits}</td>
                  <td class="right tnum">{fmtDur(v.total_ms)}</td>
                  <td>{fmtRelative(v.last_at)}</td>
                  <td>{v.nda_signed ? <Badge tone="ok">{t("Signed")}</Badge> : <Badge>{t("Not signed")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title={t("Visits")} pad={false}>
        <VisitTable visits={visits} show={{ who: true }} onDelete={async (ids) => { await api.deleteVisits(ids); setReloadKey((k) => k + 1); }} />
      </Card>

      {editing && full && (
        <LinkDialog docId={link.document_id} versions={versions} mode="edit" initial={full} onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); setReloadKey((k) => k + 1); }} />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("Delete “{0}”?", link.name)}
          body={<>{t("Links")}{" "}<span class="mono">/{link.slug}</span>{" "}{t("stops working immediately and ")}<b>{t("Permanently delete")}</b>{t("its {0} visit records are deleted. This cannot be undone. The visitors themselves and their signed NDA records are kept.", visits.length)}</>}
          confirmLabel={t("Permanently delete link")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.deleteLink(id); toast(t("Link deleted")); navigate(`/admin/documents/${link.document_id}?tab=links`); }
            catch (e) { toast((e as Error).message, "bad"); setDeleting(false); setBusy(false); }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
      {manualUrl && (
        <Modal labelledBy={`${uid}-m`} dismissOnOverlay onClose={() => setManualUrl("")}>
          <h2 id={`${uid}-m`}>{t("Please copy the link manually")}</h2>
          <input data-autofocus readOnly value={manualUrl} onFocus={(e) => e.currentTarget.select()} />
          <div class="row end"><button class="btn btn-primary" onClick={() => setManualUrl("")}>{t("Done")}</button></div>
        </Modal>
      )}
    </>
  );
}
