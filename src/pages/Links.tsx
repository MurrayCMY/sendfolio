import { useEffect, useId, useState } from "preact/hooks";
import { api, LinkRow, VersionRow } from "../api";
import { Link } from "../app";
import { fmtRelative, linkStatus, linkUrl } from "../format";
import { Badge, EmptyState, Menu, toast } from "../ui/kit";
import { IconAlert, IconCheck, IconCopy, IconEdit, IconEye, IconLink, IconPlus, IconTrash } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { BulkLinkDialog } from "./AllLinks";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkDialog } from "./LinkDialog";
import { t } from "../i18n";

/** Copies the investor-facing address; falls back to a manual-copy dialog when the browser refuses. */
export async function copyLink(slug: string, ask: (url: string) => void) {
  const url = linkUrl(slug);
  try {
    await navigator.clipboard.writeText(url);
    toast(t("Link copied"));
  } catch {
    ask(url);
  }
}

export function Links({ docId, versions, archived, onChanged }: { docId: string; versions: VersionRow[]; archived: boolean; onChanged?: () => void }) {
  const uid = useId();
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ mode: "create" | "edit" | "clone"; link?: LinkRow } | null>(null);
  const [bulking, setBulking] = useState(false);
  const [disabling, setDisabling] = useState<LinkRow | null>(null);
  const [deleting, setDeleting] = useState<LinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const flashCopy = (id: string, slug: string) => {
    copyLink(slug, setManualUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  const load = () => api.links(docId).then((r) => setLinks(r.links)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [docId]);
  const changed = () => { load(); onChanged?.(); };

  return (
    <>
      <div class="panel-head" style={{ padding: "16px 20px" }}>
        <h2>{t("Personal links")}</h2>
        {!archived && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button class="btn btn-sm" onClick={() => setBulking(true)}>{t("Bulk create")}</button>
            <button class="btn btn-primary btn-sm" onClick={() => setDialog({ mode: "create" })}><IconPlus size={15} />{" "}{t("New link")}</button>
          </div>
        )}
      </div>
      {error && <p class="field-error" role="alert" style={{ padding: "0 20px" }}>{error}</p>}
      {links && links.length === 0 && (
        <EmptyState icon={<IconLink />} title={t("No links yet")} body={t("Create one link per recipient to track each person's reading separately.")}
          action={!archived ? <button class="btn btn-primary" onClick={() => setDialog({ mode: "create" })}><IconPlus size={16} />{" "}{t("New link")}</button> : undefined} />
      )}
      {links && links.length > 0 && (
        <div class="table-wrap">
          <table class="dtable">
            <thead>
              <tr><th>{t("Name")}</th><th>{t("Link address")}</th><th>{t("Status")}</th><th class="right">{t("Visitors")}</th><th class="right">{t("Visits")}</th><th>{t("Last visit")}</th><th><span class="sr">{t("Actions")}</span></th></tr>
            </thead>
            <tbody>
              {links.map((l) => {
                const st = linkStatus(l, archived);
                return (
                  <tr key={l.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <Link href={`/admin/links/${l.id}`}><b>{l.name}</b></Link>
                        {l.visitor_count > 1 && <Badge tone="warn" icon={<IconAlert size={12} />}>{t("Forwarded")}</Badge>}
                      </div>
                      <span class="cell-sub">
                        {l.pinned_version_id ? t("Pinned version · ") : ""}{l.has_password ? t("Password · ") : ""}{l.allow_download ? t("Downloadable · ") : ""}{l.watermark ? t("Watermarked") : t("No watermark")}
                      </span>
                    </td>
                    <td>
                      <span class="url-pill">
                        <span class="mono" title={linkUrl(l.slug)}>{location.host}/{l.slug}</span>
                        <button class={`icon-btn ${copiedId === l.id ? "copied" : ""}`} aria-label={t("Copy the link “{0}”", l.name)} title={t("Copy link")} onClick={() => flashCopy(l.id, l.slug)}>
                          {copiedId === l.id ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        </button>
                      </span>
                    </td>
                    <td><Badge tone={st.tone}>{st.text}</Badge></td>
                    <td class="right tnum">{l.visitor_count}</td>
                    <td class="right tnum">{l.visit_count}</td>
                    <td class="tnum">{fmtRelative(l.last_visit_at)}</td>
                    <td class="actions">
                      <Menu label={t("More actions for “{0}”", l.name)} items={[
                        { label: t("Copy link"), icon: <IconCopy size={16} />, onClick: () => copyLink(l.slug, setManualUrl) },
                        { label: t("Preview as visitor"), icon: <IconEye size={16} />, onClick: () => window.open(`/${l.slug}?preview=1`, "_blank", "noopener"), disabled: archived || !l.enabled },
                        { label: t("Edit"), icon: <IconEdit size={16} />, onClick: () => setDialog({ mode: "edit", link: l }), disabled: archived },
                        { label: t("New from these settings"), icon: <IconPlus size={16} />, onClick: () => setDialog({ mode: "clone", link: l }), disabled: archived },
                        { label: l.enabled ? t("Disable") : t("Enable"), onClick: async () => { if (l.enabled) setDisabling(l); else { await api.updateLink(l.id, { enabled: true }); toast(t("Link has been enabled")); changed(); } }, disabled: archived, divider: false },
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
      {dialog && (
        <LinkDialog docId={docId} versions={versions} mode={dialog.mode} initial={dialog.link}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />
      )}
      {bulking && <BulkLinkDialog docId={docId} onClose={() => setBulking(false)} onDone={changed} />}
      {disabling && (
        <ConfirmDialog
          title={t("Disable “{0}”?", disabling.name)}
          body={t("The link stops working immediately; people already reading will see “link no longer available” on their next page turn. You can enable it again at any time.")}
          confirmLabel={t("Disable link")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.updateLink(disabling.id, { enabled: false }); toast(t("Link disabled")); setDisabling(null); changed(); }
            catch (e) { toast((e as Error).message, "bad"); setDisabling(null); }
            setBusy(false);
          }}
          onClose={() => setDisabling(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("Delete “{0}”?", deleting.name)}
          body={<>{t("Links")}{" "}<span class="mono">/{deleting.slug}</span>{" "}{t("stops working immediately and ")}<b>{t("Permanently delete")}</b>{t("its {0} visit records and per-page reading times are deleted. This cannot be undone.", deleting.visit_count)}<br />{t("The visitors themselves and their signed NDA records are kept. To switch it off only for now, use “Disable” instead.")}</>}
          confirmLabel={t("Permanently delete link")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.deleteLink(deleting.id); toast(t("Link deleted")); setDeleting(null); changed(); }
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
