import { useEffect, useId, useState } from "preact/hooks";
import { AllLinkRow, api, DocRow, LinkInput } from "../api";
import { Link } from "../app";
import { fmtRelative, linkStatus, linkUrl } from "../format";
import { t } from "../i18n";
import { IconAlert, IconCheck, IconCopy, IconEye, IconLink, IconPlus, IconSearch, IconTrash } from "../ui/icons";
import { Badge, EmptyState, Field, Menu, PageHeader, toast } from "../ui/kit";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { copyLink } from "./Links";

type PresetId = "diligence" | "pitch" | "teaser";
type FilterId = "all" | "active" | "forwarded" | "unopened" | "disabled";

function presetInput(p: PresetId): LinkInput {
  if (p === "diligence") return { require_email: true, require_otp: true, block_personal_email: true, require_nda: true, watermark: true, allow_download: false, notify_on_open: true };
  if (p === "pitch") return { require_email: true, require_otp: true, block_personal_email: false, require_nda: false, watermark: true, allow_download: false, notify_on_open: true };
  return { require_email: false, require_otp: false, block_personal_email: false, require_nda: false, watermark: false, allow_download: false, notify_on_open: true };
}

/** Generate up to 50 personalized links in one shot from a list of recipient names. */
export function BulkLinkDialog(props: { docId?: string; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docId, setDocId] = useState(props.docId ?? "");
  const [preset, setPreset] = useState<PresetId>("pitch");
  const [namesText, setNamesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; slug: string }[] | null>(null);

  useEffect(() => {
    if (props.docId) return;
    api.documents().then((r) => {
      const active = r.documents.filter((d) => !d.archived_at);
      setDocs(active);
      if (active.length && !docId) setDocId(active[0].id);
    }).catch(() => {});
  }, []);

  const names = namesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  async function submit(e: Event) {
    e.preventDefault();
    if (!docId || !names.length) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.createBulkLinks(docId, { ...presetInput(preset), names });
      setCreated(r.links);
      props.onDone();
      toast(t("{0} links created", r.links.length));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function copyAll() {
    if (!created) return;
    const text = created.map((l) => `${l.name}\t${linkUrl(l.slug)}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(t("All links copied")); }
    catch { toast(t("Copy failed — select from the list below"), "bad"); }
  }

  return (
    <Modal labelledBy={`${uid}-t`} class="wide" busy={busy} onClose={props.onClose}>
      {created ? (
        <div class="dform">
          <h2 id={`${uid}-t`}>{t("{0} links ready to share", created.length)}</h2>
          <p class="muted" style={{ margin: "0 0 12px" }}>{t("Copy all as a tab-separated table (pastes cleanly into spreadsheets) or copy individually.")}</p>
          <div class="table-wrap bulk-results">
            <table class="dtable">
              <thead><tr><th>{t("Name")}</th><th>{t("Link address")}</th><th /></tr></thead>
              <tbody>
                {created.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.name}</b></td>
                    <td class="mono">{linkUrl(l.slug)}</td>
                    <td class="actions">
                      <button type="button" class="btn btn-sm" onClick={() => copyLink(l.slug, () => {})}><IconCopy size={14} />{" "}{t("Copy")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" onClick={copyAll}><IconCopy size={15} />{" "}{t("Copy all")}</button>
            <button type="button" class="btn btn-primary" onClick={props.onClose}><IconCheck size={16} />{" "}{t("Done")}</button>
          </div>
        </div>
      ) : (
        <form class="dform" onSubmit={submit} aria-busy={busy}>
          <h2 id={`${uid}-t`}>{t("Bulk create links")}</h2>
          <p class="muted" style={{ margin: "0 0 14px" }}>{t("Paste one recipient per line to generate personalized, individually tracked links in one click.")}</p>
          {!props.docId && (
            <Field label={t("Document")} required>
              {(id) => (
                <select id={id} required value={docId} onChange={(e) => setDocId(e.currentTarget.value)}>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              )}
            </Field>
          )}
          <div class="field">
            <label>{t("Security preset")}</label>
            <div class="preset-grid" role="radiogroup" aria-label={t("Security preset")}>
              <button type="button" role="radio" aria-checked={preset === "diligence"} class={`preset-card ${preset === "diligence" ? "on" : ""}`} onClick={() => setPreset("diligence")}>
                <b>{t("Confidential diligence")}</b>
                <span>{t("Work email · Email code · NDA · Watermark")}</span>
              </button>
              <button type="button" role="radio" aria-checked={preset === "pitch"} class={`preset-card ${preset === "pitch" ? "on" : ""}`} onClick={() => setPreset("pitch")}>
                <b>{t("Investor pitch")}</b>
                <span>{t("Email · Email code · Watermark · No NDA")}</span>
              </button>
              <button type="button" role="radio" aria-checked={preset === "teaser"} class={`preset-card ${preset === "teaser" ? "on" : ""}`} onClick={() => setPreset("teaser")}>
                <b>{t("Open teaser")}</b>
                <span>{t("Instant view · No sign-in · Tracked")}</span>
              </button>
            </div>
          </div>
          <Field label={t("Recipients (one per line, up to 50)")} required hint={names.length ? t("{0} recipients ready", Math.min(names.length, 50)) : undefined}>
            {(id, d) => (
              <textarea id={id} aria-describedby={d} rows={7} required placeholder={"Sequoia – Sarah\nBenchmark – Eric\nLightspeed – Maya"} value={namesText} onInput={(e) => setNamesText(e.currentTarget.value)} />
            )}
          </Field>
          {error && <p class="field-error" role="alert">{error}</p>}
          <div class="dialog-foot">
            <button type="button" class="btn" disabled={busy} onClick={props.onClose}>{t("Cancel")}</button>
            <button class="btn btn-primary" disabled={busy || !docId || !names.length}>
              {busy ? t("Creating…") : <><IconPlus size={16} />{" "}{t("Generate {0} links", Math.min(names.length, 50))}</>}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function AllLinks() {
  const uid = useId();
  const [rows, setRows] = useState<AllLinkRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [bulking, setBulking] = useState(false);
  const [deleting, setDeleting] = useState<AllLinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  const load = () => api.allLinks().then((r) => setRows(r.links)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const isActive = (l: AllLinkRow) => l.enabled && !l.doc_archived && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now());
  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((l) => {
    if (q && !l.name.toLowerCase().includes(q) && !l.doc_title.toLowerCase().includes(q) && !l.slug.toLowerCase().includes(q)) return false;
    if (filter === "active") return isActive(l);
    if (filter === "forwarded") return l.visitor_count > 1;
    if (filter === "unopened") return isActive(l) && l.visit_count === 0;
    if (filter === "disabled") return !isActive(l);
    return true;
  });

  const cnt = {
    all: (rows ?? []).length,
    active: (rows ?? []).filter(isActive).length,
    forwarded: (rows ?? []).filter((l) => l.visitor_count > 1).length,
    unopened: (rows ?? []).filter((l) => isActive(l) && l.visit_count === 0).length,
    disabled: (rows ?? []).filter((l) => !isActive(l)).length,
  };

  return (
    <>
      <PageHeader
        title={t("Links")}
        subtitle={t("Every recipient link across all documents, with forwarding detection and bulk creation.")}
        actions={<button class="btn btn-primary" onClick={() => setBulking(true)}><IconPlus size={16} />{" "}{t("Bulk create links")}</button>}
      />
      {error && <p class="field-error" role="alert">{error}</p>}
      {rows && rows.length > 0 && (
        <div class="toolbar">
          <label class="search">
            <IconSearch size={16} />
            <input type="search" aria-label={t("Search links")} placeholder={t("Search link name, document, or address")} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </label>
          <div class="chips" role="group" aria-label={t("Filter links")}>
            <button class={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>{t("All {0}", cnt.all)}</button>
            <button class={`chip ${filter === "active" ? "on" : ""}`} onClick={() => setFilter("active")}>{t("Active")} {cnt.active}</button>
            <button class={`chip ${filter === "forwarded" ? "on" : ""}`} onClick={() => setFilter("forwarded")}><IconAlert size={13} />{" "}{t("Forwarded")} {cnt.forwarded}</button>
            <button class={`chip ${filter === "unopened" ? "on" : ""}`} onClick={() => setFilter("unopened")}>{t("Unopened")} {cnt.unopened}</button>
            <button class={`chip ${filter === "disabled" ? "on" : ""}`} onClick={() => setFilter("disabled")}>{t("Inactive")} {cnt.disabled}</button>
          </div>
        </div>
      )}
      <div class="panel">
        {rows === null ? <><div class="skel-row" /><div class="skel-row" /><div class="skel-row" /></> : rows.length === 0 ? (
          <EmptyState icon={<IconLink />} title={t("No links yet")} body={t("Create personalized links from any document, or generate a batch right here.")}
            action={<button class="btn btn-primary" onClick={() => setBulking(true)}><IconPlus size={16} />{" "}{t("Bulk create links")}</button>} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<IconSearch />} title={t("No matching links")} body={t("Try another keyword or clear the filters.")} />
        ) : (
          <div class="table-wrap">
            <table class="dtable">
              <thead>
                <tr><th>{t("Name")}</th><th>{t("Document")}</th><th>{t("Link address")}</th><th>{t("Status")}</th><th class="right">{t("Visitors")}</th><th class="right">{t("Visits")}</th><th>{t("Last visit")}</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const st = linkStatus(l, l.doc_archived);
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <Link href={`/admin/links/${l.id}`}><b>{l.name}</b></Link>
                          {l.visitor_count > 1 && <Badge tone="warn" icon={<IconAlert size={12} />}>{t("Forwarded")}</Badge>}
                        </div>
                      </td>
                      <td class="clip"><Link href={`/admin/documents/${l.document_id}`}>{l.doc_title}</Link></td>
                      <td>
                        <span class="url-pill">
                          <span class="mono" title={linkUrl(l.slug)}>{location.host}/{l.slug}</span>
                          <button class="icon-btn" aria-label={t("Copy the link “{0}”", l.name)} title={t("Copy link")} onClick={() => copyLink(l.slug, setManualUrl)}><IconCopy size={14} /></button>
                        </span>
                      </td>
                      <td class="nw"><Badge tone={st.tone}>{st.text}</Badge></td>
                      <td class="right tnum">{l.visitor_count}</td>
                      <td class="right tnum">{l.visit_count}</td>
                      <td class="tnum nw">{fmtRelative(l.last_visit_at)}</td>
                      <td class="actions">
                        <Menu label={t("More actions for “{0}”", l.name)} items={[
                          { label: t("Copy link"), icon: <IconCopy size={16} />, onClick: () => copyLink(l.slug, setManualUrl) },
                          { label: t("Preview as visitor"), icon: <IconEye size={16} />, onClick: () => window.open(`/${l.slug}?preview=1`, "_blank", "noopener"), disabled: !isActive(l) },
                          { label: l.enabled ? t("Disable") : t("Enable"), onClick: async () => { await api.updateLink(l.id, { enabled: !l.enabled }); toast(l.enabled ? t("Link disabled") : t("Link has been enabled")); load(); }, disabled: l.doc_archived },
                          { label: "", onClick: () => {}, divider: true },
                          { label: t("Delete"), icon: <IconTrash size={16} />, danger: true, onClick: () => setDeleting(l) },
                        ]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {bulking && <BulkLinkDialog onClose={() => setBulking(false)} onDone={load} />}
      {deleting && (
        <ConfirmDialog
          title={t("Delete “{0}”?", deleting.name)}
          body={<>{t("Links")}{" "}<span class="mono">/{deleting.slug}</span>{" "}{t("stops working immediately and ")}<b>{t("Permanently delete")}</b>{t("its {0} visit records and per-page reading times are deleted. This cannot be undone.", deleting.visit_count)}</>}
          confirmLabel={t("Permanently delete link")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.deleteLink(deleting.id); toast(t("Link deleted")); setDeleting(null); load(); }
            catch (e) { toast((e as Error).message, "bad"); setDeleting(null); }
            setBusy(false);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {manualUrl && (
        <Modal labelledBy={`${uid}-m`} dismissOnOverlay onClose={() => setManualUrl("")}>
          <h2 id={`${uid}-m`}>{t("Please copy the link manually")}</h2>
          <p class="muted">{t("Your browser blocked automatic copying. Select the link below and press Ctrl+C (⌘+C on a Mac).")}</p>
          <input data-autofocus readOnly value={manualUrl} onFocus={(e) => e.currentTarget.select()} />
          <div class="row end"><button class="btn btn-primary" onClick={() => setManualUrl("")}>{t("Done")}</button></div>
        </Modal>
      )}
    </>
  );
}
