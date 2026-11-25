import { useEffect, useState } from "preact/hooks";
import { api, DocRow } from "../api";
import { Link, navigate } from "../app";
import { fmtRelative } from "../format";
import { IconFile, IconPlus, IconSearch } from "../ui/icons";
import { Badge, EmptyState, PageHeader } from "../ui/kit";
import { UploadDialog } from "./UploadDialog";
import { t } from "../i18n";

function DocCard({ d }: { d: DocRow }) {
  return (
    <Link href={`/admin/documents/${d.id}`} class={`doc-card ${d.archived_at ? "archived" : ""}`}>
      <div class="doc-thumb">{d.version_id && <img src={api.thumbUrl(d.version_id, 1)} alt="" loading="lazy" />}</div>
      <div class="doc-info">
        <h3>{d.title}</h3>
        <div class="sub">
          {d.archived_at ? <Badge>{t("Archived")}</Badge> : null} {d.version_label ?? t("No version yet")}{d.page_count ? t("· {0} pages", d.page_count) : ""}
        </div>
        <div class="doc-stats">
          <div><b>{d.link_count}</b><span>{t("Links")}</span></div>
          <div><b>{d.visit_count}</b><span>{t("Visits")}</span></div>
          <div><b style={{ fontSize: "14px", lineHeight: "26px" }}>{d.last_visit_at ? fmtRelative(d.last_visit_at) : "—"}</b><span>{t("Last visit")}</span></div>
        </div>
      </div>
    </Link>
  );
}

export function Documents() {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { api.documents().then((r) => setDocs(r.documents)).catch((e) => setError(e.message)); }, []);

  const shown = (docs ?? []).filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <PageHeader
        title={t("Documents")}
        subtitle={t("Upload confidential files and create a personal link for each recipient.")}
        actions={<button class="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} />{" "}{t("New document")}</button>}
      />
      {error && <p class="field-error" role="alert">{error}</p>}
      {docs && docs.length > 3 && (
        <div class="toolbar">
          <label class="search">
            <IconSearch size={16} />
            <input type="search" aria-label={t("Search documents")} placeholder={t("Search document titles")} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </label>
        </div>
      )}
      {docs === null && !error && <div class="doc-grid">{[0, 1, 2].map((i) => <div key={i} class="panel" style={{ height: "290px" }}><div class="skel-row" /><div class="skel-row" /></div>)}</div>}
      {docs && docs.length === 0 && (
        <div class="panel">
          <EmptyState icon={<IconFile />} title={t("No documents yet")} body={t("Upload your first PDF. Pages are rendered to images in your browser, so recipients never get the original file.")}
            action={<button class="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} />{" "}{t("New document")}</button>} />
        </div>
      )}
      {docs && docs.length > 0 && (
        shown.length ? <div class="doc-grid">{shown.map((d) => <DocCard key={d.id} d={d} />)}</div>
          : <p class="muted">{t("No document title contains “{0}”.", query)}</p>
      )}
      {creating && <UploadDialog onClose={() => setCreating(false)} onDone={(id) => navigate(`/admin/documents/${id}`)} />}
    </>
  );
}
