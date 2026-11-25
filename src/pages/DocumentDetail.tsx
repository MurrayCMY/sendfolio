import { useEffect, useState } from "preact/hooks";
import { api, DocStats, LinkRow, VersionRow, VisitRow } from "../api";
import { Link } from "../app";
import { fmtDur, fmtTime } from "../format";
import { IconArchive, IconArrowLeft, IconDownload, IconUpload } from "../ui/icons";
import { Badge, Card, EmptyState, Field, Menu, PageHeader, StatCard, Tabs, toast } from "../ui/kit";
import { BarChart } from "./BarChart";
import { ConfirmDialog } from "./ConfirmDialog";
import { Links } from "./Links";
import { UploadDialog } from "./UploadDialog";
import { VisitTable } from "./VisitTable";
import { t } from "../i18n";

type Detail = Awaited<ReturnType<typeof api.document>>;
type TabId = "data" | "links" | "visits" | "pages" | "settings";
const TAB_IDS: TabId[] = ["data", "links", "visits", "pages", "settings"];

function initialTab(): TabId {
  const q = new URLSearchParams(location.search).get("tab");
  return (TAB_IDS as string[]).includes(q ?? "") ? (q as TabId) : "data";
}

export function DocumentDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<VersionRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<DocStats | null>(null);
  const [linkList, setLinkList] = useState<LinkRow[]>([]);
  const [linkFilter, setLinkFilter] = useState("");
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const changeTab = (t: TabId) => {
    setTab(t);
    const u = new URL(location.href);
    u.searchParams.set("tab", t);
    history.replaceState({}, "", u);
  };

  const load = () =>
    api.document(id).then((r) => {
      setData(r);
      setTitle(r.document.title);
      setNote(r.document.note ?? "");
      setSelected((cur) => r.versions.find((v) => v.id === cur?.id) ?? r.versions[0] ?? null);
    }).catch((e) => setError(e.message));

  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.links(id).then((r) => setLinkList(r.links)).catch(() => setLinkList([])); }, [id, reloadKey]);
  useEffect(() => {
    if (selected) api.docStats(id, selected.id, linkFilter || undefined).then(setStats).catch(() => setStats(null));
  }, [id, selected?.id, linkFilter, reloadKey]);
  useEffect(() => {
    api.docVisits(id, linkFilter || undefined).then((r) => setVisits(r.visits)).catch(() => setVisits([]));
  }, [id, linkFilter, reloadKey]);

  if (error) return <p class="field-error" role="alert">{error}</p>;
  if (!data) return <div class="panel"><div class="skel-row" /><div class="skel-row" /><div class="skel-row" /></div>;
  const { document: doc, versions } = data;
  const archived = !!doc.archived_at;

  const filter = (
    <div class="filter-row">
      <select aria-label={t("Filter by link")} value={linkFilter} onChange={(e) => setLinkFilter(e.currentTarget.value)}>
        <option value="">{t("All links")}</option>
        {linkList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </div>
  );
  const versionChips = versions.length > 1 && (
    <div class="chips" role="group" aria-label={t("Choose a version")}>
      {versions.map((v) => (
        <button key={v.id} class={`version-chip ${selected?.id === v.id ? "on" : ""}`} aria-pressed={selected?.id === v.id} onClick={() => setSelected(v)}>
          {v.version_label}<small>{t("{0} pages · {1}", v.page_count, fmtTime(v.created_at).slice(0, 10))}</small>
        </button>
      ))}
    </div>
  );
  const exportQs = `document=${id}${linkFilter ? `&link=${linkFilter}` : ""}`;

  return (
    <>
      <PageHeader
        back={<Link href="/admin/documents"><IconArrowLeft size={15} />{" "}{t("All documents")}</Link>}
        title={doc.title}
        subtitle={doc.note || undefined}
        meta={<>
          {archived && <Badge>{t("Archived")}</Badge>}
          {selected && <Badge tone="info">{t("Latest {0}", versions[0]?.version_label)}</Badge>}
          <span class="muted">{t("{0} pages · {1} version(s) · created {2}", selected?.page_count ?? 0, versions.length, fmtTime(doc.created_at).slice(0, 10))}</span>
        </>}
        actions={!archived && <>
          <button class="btn btn-primary" onClick={() => setUploading(true)}><IconUpload size={16} />{" "}{t("Upload new version")}</button>
          <Menu label={t("More document actions")} items={[{ label: t("Archive document"), icon: <IconArchive size={16} />, danger: true, onClick: () => setArchiving(true) }]} />
        </>}
      />

      <Tabs label={t("Document content")} value={tab} onChange={changeTab} tabs={[
        { id: "data", label: t("Reading data") },
        { id: "links", label: t("Links"), count: linkList.length },
        { id: "visits", label: t("Visits"), count: visits?.length },
        { id: "pages", label: t("Pages") },
        { id: "settings", label: t("Settings") },
      ]} />

      {tab === "data" && (
        <div role="tabpanel" id="panel-data" aria-labelledby="tab-data">
          <div class="toolbar" style={{ justifyContent: "space-between" }}>
            {versionChips || <span />}
            <div class="filter-row">
              {filter}
              <a class="btn btn-sm" href={`/api/admin/export/visits.csv?${exportQs}`} download><IconDownload size={15} />{" "}{t("Export visits")}</a>
              <a class="btn btn-sm" href={`/api/admin/export/page-views.csv?${exportQs}`} download><IconDownload size={15} />{" "}{t("Export time per page")}</a>
            </div>
          </div>
          {stats?.version && (
            <>
              <div class="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                <StatCard label={t("Visits")} value={stats.visits} hint={t("Version {0}", selected?.version_label ?? "")} />
                <StatCard label={t("Visitors")} value={stats.visitors} />
                <StatCard label={t("Average reach")} value={stats.pages.length ? `${Math.round(stats.pages.filter((p) => p.reach >= 0.5).length)}` : "—"} hint={t("pages; more than half of readers get this far")} />
              </div>
              <Card title={t("Page reading heat map · {0}", selected?.version_label ?? "")}>
                {stats.visits === 0 ? (
                  <EmptyState title={t("No visits yet")} body={linkFilter ? t("Nobody has read this version through this link yet.") : t("Nobody has read this version yet.")} />
                ) : (
                  <BarChart
                    versionId={selected!.id}
                    bars={stats.pages.map((p) => ({ page: p.page, ms: p.avg_ms, note: `${Math.round(p.reach * 100)}%` }))}
                    caption={t("Bar height: average active seconds per visit on that page ({0} visits, {1} visitors; visits that never reached the page count as 0). Percentage below: share of visits that reached the page, which shows where readers drop off.", stats.visits, stats.visitors)}
                  />
                )}
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "links" && (
        <div role="tabpanel" id="panel-links" aria-labelledby="tab-links" class="panel">
          <Links docId={id} versions={versions} archived={archived} onChanged={() => setReloadKey((k) => k + 1)} />
        </div>
      )}

      {tab === "visits" && (
        <div role="tabpanel" id="panel-visits" aria-labelledby="tab-visits">
          <div class="toolbar">{filter}<span class="muted">{t("Latest 50 visits, all versions of this document")}</span></div>
          <div class="panel">
            {visits && (
              <VisitTable visits={visits} show={{ who: true, link: !linkFilter, version: true }}
                onDelete={async (ids) => { await api.deleteVisits(ids); setReloadKey((k) => k + 1); }} />
            )}
          </div>
        </div>
      )}

      {tab === "pages" && selected && (
        <div role="tabpanel" id="panel-pages" aria-labelledby="tab-pages">
          <div class="toolbar">{versionChips}</div>
          <div class="thumb-grid">
            {Array.from({ length: selected.page_count }, (_, n) => n + 1).map((n) => (
              <a key={n} href={api.pageUrl(selected.id, n)} target="_blank" rel="noopener" aria-label={t("View page {0} larger", n)}>
                <img src={api.thumbUrl(selected.id, n)} alt="" loading="lazy" /><span>{n}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
          <Card title={t("Details")}>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try { await api.updateDocument(id, title, note); toast(t("Saved")); load(); } catch (err) { toast((err as Error).message, "bad"); }
            }} style={{ maxWidth: "560px" }}>
              <Field label={t("Title")} required>{(fid) => <input id={fid} required maxLength={200} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />}</Field>
              <Field label={t("Internal note")} hint={t("Only you can see this")}>{(fid, d) => <textarea id={fid} aria-describedby={d} rows={3} maxLength={2000} value={note} onInput={(e) => setNote(e.currentTarget.value)} />}</Field>
              <button class="btn btn-primary" disabled={!title.trim() || (title === doc.title && note === (doc.note ?? ""))}>{t("Save")}</button>
            </form>
          </Card>
          {!archived && (
            <Card title={t("Archive")}>
              <p class="muted" style={{ marginTop: 0 }}>{t("Archiving disables every link to this document; viewers will see “link no longer available”. You can no longer upload versions or create links for it.")}</p>
              <button class="btn btn-danger" onClick={() => setArchiving(true)}><IconArchive size={16} />{" "}{t("Archive this document")}</button>
            </Card>
          )}
        </div>
      )}

      {archiving && (
        <ConfirmDialog
          title={t("Archive this document?")}
          body={t("Archiving disables every link to this document; viewers will see “link no longer available”. You can no longer upload versions or create links for it.")}
          confirmLabel={t("Archive")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.archive(id); toast(t("Document archived")); setArchiving(false); await load(); }
            catch (e) { toast((e as Error).message, "bad"); setArchiving(false); }
            setBusy(false);
          }}
          onClose={() => setArchiving(false)}
        />
      )}
      {uploading && <UploadDialog docId={id} onClose={() => setUploading(false)} onDone={() => { setUploading(false); toast(t("New version uploaded")); load(); }} />}
    </>
  );
}
