import { useEffect, useId, useState } from "preact/hooks";
import { api, DocRow, LinkRow, RoomRow } from "../api";
import { Link, navigate } from "../app";
import { fmtRelative, linkStatus, linkUrl } from "../format";
import { t } from "../i18n";
import { IconAlert, IconArchive, IconArrowLeft, IconCheck, IconCopy, IconEdit, IconEye, IconFile, IconLink, IconPlus, IconTrash } from "../ui/icons";
import { Badge, Card, EmptyState, Field, Menu, PageHeader, Tabs, toast } from "../ui/kit";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkDialog } from "./LinkDialog";
import { copyLink } from "./Links";

interface PickedItem { document_id: string; section: string }

function CreateRoomDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const uid = useId();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.documents().then((r) => setDocs(r.documents.filter((d) => !d.archived_at && d.version_id))).catch(() => {});
  }, []);

  const toggle = (docId: string) => {
    setPicked((cur) => cur.some((x) => x.document_id === docId) ? cur.filter((x) => x.document_id !== docId) : [...cur, { document_id: docId, section: "" }]);
  };
  const setSection = (docId: string, section: string) => {
    setPicked((cur) => cur.map((x) => x.document_id === docId ? { ...x, section } : x));
  };

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api.createRoom(title, desc, picked);
      toast(t("Data room created"));
      onDone(r.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy={`${uid}-t`} class="wide" busy={busy} onClose={onClose}>
      <form class="dform" onSubmit={submit} aria-busy={busy}>
        <h2 id={`${uid}-t`}>{t("New data room")}</h2>
        <p class="muted" style={{ margin: "0 0 14px" }}>{t("Group multiple documents under one link and one NDA for fundraising or enterprise diligence.")}</p>
        <Field label={t("Data room title")} required>
          {(id) => <input id={id} data-autofocus required maxLength={160} placeholder={t("e.g. Series A Data Room")} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />}
        </Field>
        <Field label={t("Welcome note (optional, shown to visitors)")}>
          {(id) => <textarea id={id} rows={2} maxLength={1000} placeholder={t("e.g. Confidential diligence materials for Q4.")} value={desc} onInput={(e) => setDesc(e.currentTarget.value)} />}
        </Field>
        <div class="field">
          <label>{t("Select documents to include")}</label>
          {docs.length === 0 ? (
            <p class="muted small">{t("Upload at least one PDF document first.")}</p>
          ) : (
            <div class="room-picker">
              {docs.map((d) => {
                const sel = picked.find((x) => x.document_id === d.id);
                return (
                  <div key={d.id} class={`room-pick-row ${sel ? "on" : ""}`}>
                    <label class="room-pick-check">
                      <input type="checkbox" checked={!!sel} onChange={() => toggle(d.id)} />
                      <span><b>{d.title}</b><small class="muted">{d.page_count ? ` · ${d.page_count}p` : ""}</small></span>
                    </label>
                    {sel && (
                      <input type="text" class="room-sec-input" maxLength={80} placeholder={t("Section (optional, e.g. Financials)")} value={sel.section} onInput={(e) => setSection(d.id, e.currentTarget.value)} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {error && <p class="field-error" role="alert">{error}</p>}
        <div class="dialog-foot">
          <button type="button" class="btn" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
          <button class="btn btn-primary" disabled={busy || !title.trim()}>{busy ? t("Creating…") : <><IconPlus size={16} />{" "}{t("Create data room")}</>}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Rooms() {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => { api.rooms().then((r) => setRooms(r.rooms)).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <PageHeader
        title={t("Data rooms")}
        subtitle={t("Share a curated folder of documents under one link, one email verification, and one NDA.")}
        actions={<button class="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} />{" "}{t("New data room")}</button>}
      />
      {error && <p class="field-error" role="alert">{error}</p>}
      {rooms === null && !error && <div class="doc-grid">{[0, 1].map((i) => <div key={i} class="panel" style={{ height: "180px" }}><div class="skel-row" /><div class="skel-row" /></div>)}</div>}
      {rooms && rooms.length === 0 && (
        <div class="panel">
          <EmptyState icon={<IconFile />} title={t("No data rooms yet")} body={t("Bundle your pitch deck, financials, and supporting memos into one investor-ready data room.")}
            action={<button class="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={16} />{" "}{t("New data room")}</button>} />
        </div>
      )}
      {rooms && rooms.length > 0 && (
        <div class="doc-grid">
          {rooms.map((r) => (
            <Link key={r.id} href={`/admin/rooms/${r.id}`} class={`doc-card ${r.archived_at ? "archived" : ""}`}>
              <div class="doc-info">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <h3>{r.title}</h3>
                  {r.archived_at ? <Badge>{t("Archived")}</Badge> : <Badge tone="info">{t("Data room")}</Badge>}
                </div>
                {r.description && <div class="sub" style={{ marginTop: "4px" }}>{r.description}</div>}
                <div class="doc-stats">
                  <div><b>{r.doc_count}</b><span>{t("Documents")}</span></div>
                  <div><b>{r.link_count}</b><span>{t("Links")}</span></div>
                  <div><b>{r.visit_count}</b><span>{t("Visits")}</span></div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateRoomDialog onClose={() => setCreating(false)} onDone={(id) => navigate(`/admin/rooms/${id}`)} />}
    </>
  );
}

type RoomDetailData = Awaited<ReturnType<typeof api.room>>;

export function RoomDetail({ id }: { id: string }) {
  const [data, setData] = useState<RoomDetailData | null>(null);
  const [allDocs, setAllDocs] = useState<DocRow[]>([]);
  const [tab, setTab] = useState<"files" | "links" | "settings">("files");
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [linkModal, setLinkModal] = useState<{ mode: "create" | "edit"; link?: LinkRow } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deletingLink, setDeletingLink] = useState<LinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    api.room(id).then((r) => {
      setData(r);
      setTitle(r.room.title);
      setDesc(r.room.description ?? "");
      setPicked(r.items.map((i) => ({ document_id: i.document_id, section: i.section ?? "" })));
    }).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    api.documents().then((r) => setAllDocs(r.documents.filter((d) => !d.archived_at && d.version_id))).catch(() => {});
  }, [id]);

  if (error) return <p class="field-error" role="alert">{error}</p>;
  if (!data) return <div class="panel"><div class="skel-row" /><div class="skel-row" /></div>;

  const { room, links } = data;
  const archived = !!room.archived_at;
  const previewLink = links.find((l) => l.enabled && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now()));

  const toggle = (docId: string) => setPicked((cur) => cur.some((x) => x.document_id === docId) ? cur.filter((x) => x.document_id !== docId) : [...cur, { document_id: docId, section: "" }]);
  const setSection = (docId: string, section: string) => setPicked((cur) => cur.map((x) => x.document_id === docId ? { ...x, section } : x));

  async function saveFiles() {
    setBusy(true);
    try { await api.updateRoom(id, { items: picked }); toast(t("Saved")); load(); }
    catch (e) { toast((e as Error).message, "bad"); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader
        back={<Link href="/admin/rooms"><IconArrowLeft size={15} />{" "}{t("All data rooms")}</Link>}
        title={room.title}
        subtitle={room.description || undefined}
        meta={<>{archived && <Badge>{t("Archived")}</Badge>}<Badge tone="info">{t("{0} documents", data.items.length)}</Badge></>}
        actions={!archived && <>
          {previewLink && (
            <button class="btn" onClick={() => window.open(`/${previewLink.slug}?preview=1`, "_blank", "noopener")}>
              <IconEye size={16} />{" "}{t("Preview as visitor")}
            </button>
          )}
          <button class="btn btn-primary" disabled={data.items.length === 0} onClick={() => setLinkModal({ mode: "create" })}><IconPlus size={16} />{" "}{t("New link")}</button>
          <Menu label={t("More actions")} items={[{ label: t("Archive data room"), icon: <IconArchive size={16} />, danger: true, onClick: () => setArchiving(true) }]} />
        </>}
      />

      <Tabs label={t("Data room sections")} value={tab} onChange={setTab} tabs={[
        { id: "files", label: t("Documents"), count: data.items.length },
        { id: "links", label: t("Links"), count: links.length },
        { id: "settings", label: t("Settings") },
      ]} />

      {tab === "files" && (
        <Card title={t("Documents in this data room")} action={!archived && <button class="btn btn-primary btn-sm" disabled={busy} onClick={saveFiles}><IconCheck size={15} />{" "}{t("Save files")}</button>}>
          <p class="muted" style={{ marginTop: 0 }}>{t("Select documents and optionally group them into sections (e.g. Overview, Financials, Technical).")}</p>
          <div class="room-picker">
            {allDocs.map((d) => {
              const sel = picked.find((x) => x.document_id === d.id);
              return (
                <div key={d.id} class={`room-pick-row ${sel ? "on" : ""}`}>
                  <label class="room-pick-check">
                    <input type="checkbox" disabled={archived} checked={!!sel} onChange={() => toggle(d.id)} />
                    <span><b>{d.title}</b><small class="muted">{d.page_count ? ` · ${d.page_count}p` : ""}</small></span>
                  </label>
                  {sel && (
                    <input type="text" disabled={archived} class="room-sec-input" maxLength={80} placeholder={t("Section (optional, e.g. Financials)")} value={sel.section} onInput={(e) => setSection(d.id, e.currentTarget.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === "links" && (
        <div class="panel">
          <div class="panel-head" style={{ padding: "16px 20px" }}>
            <h2>{t("Data room links")}</h2>
            {!archived && <button class="btn btn-primary btn-sm" disabled={data.items.length === 0} onClick={() => setLinkModal({ mode: "create" })}><IconPlus size={15} />{" "}{t("New link")}</button>}
          </div>
          {links.length === 0 ? (
            <EmptyState icon={<IconLink />} title={t("No links yet")} body={t("Create one link per investor or buyer so they can access every document in this room under one NDA.")} />
          ) : (
            <div class="table-wrap"><table class="dtable">
              <thead><tr><th>{t("Name")}</th><th>{t("Link address")}</th><th>{t("Status")}</th><th class="right">{t("Visitors")}</th><th class="right">{t("Visits")}</th><th>{t("Last visit")}</th><th /></tr></thead>
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
                      </td>
                      <td>
                        <span class="url-pill">
                          <span class="mono" title={linkUrl(l.slug)}>{location.host}/{l.slug}</span>
                          <button class="icon-btn" aria-label={t("Copy link")} onClick={() => copyLink(l.slug, () => {})}><IconCopy size={14} /></button>
                        </span>
                      </td>
                      <td><Badge tone={st.tone}>{st.text}</Badge></td>
                      <td class="right tnum">{l.visitor_count}</td>
                      <td class="right tnum">{l.visit_count}</td>
                      <td class="tnum">{fmtRelative(l.last_visit_at)}</td>
                      <td class="actions">
                        <Menu label={t("More actions")} items={[
                          { label: t("Copy link"), icon: <IconCopy size={16} />, onClick: () => copyLink(l.slug, () => {}) },
                          { label: t("Preview as visitor"), icon: <IconEye size={16} />, onClick: () => window.open(`/${l.slug}?preview=1`, "_blank", "noopener"), disabled: archived || !l.enabled },
                          { label: t("Edit"), icon: <IconEdit size={16} />, onClick: () => setLinkModal({ mode: "edit", link: l }), disabled: archived },
                          { label: t("Delete"), icon: <IconTrash size={16} />, danger: true, onClick: () => setDeletingLink(l) },
                        ]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <Card title={t("Details")}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try { await api.updateRoom(id, { title, description: desc }); toast(t("Saved")); load(); } catch (err) { toast((err as Error).message, "bad"); }
          }} style={{ maxWidth: "560px" }}>
            <Field label={t("Data room title")} required>{(fid) => <input id={fid} required maxLength={160} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />}</Field>
            <Field label={t("Welcome note (optional, shown to visitors)")}>{(fid) => <textarea id={fid} rows={3} maxLength={1000} value={desc} onInput={(e) => setDesc(e.currentTarget.value)} />}</Field>
            <button class="btn btn-primary" disabled={!title.trim()}>{t("Save")}</button>
          </form>
        </Card>
      )}

      {linkModal && (
        <LinkDialog roomId={id} versions={[]} mode={linkModal.mode} initial={linkModal.link}
          onClose={() => setLinkModal(null)} onDone={() => { setLinkModal(null); load(); }} />
      )}
      {archiving && (
        <ConfirmDialog title={t("Archive this data room?")} body={t("Archiving disables every link to this data room.")} confirmLabel={t("Archive")} danger busy={busy}
          onConfirm={async () => { setBusy(true); try { await api.archiveRoom(id); toast(t("Data room archived")); setArchiving(false); load(); } catch (e) { toast((e as Error).message, "bad"); } setBusy(false); }}
          onClose={() => setArchiving(false)} />
      )}
      {deletingLink && (
        <ConfirmDialog title={t("Delete “{0}”?", deletingLink.name)} body={t("This permanently deletes the link and its visit records.")} confirmLabel={t("Permanently delete link")} danger busy={busy}
          onConfirm={async () => { setBusy(true); try { await api.deleteLink(deletingLink.id); toast(t("Link deleted")); setDeletingLink(null); load(); } catch (e) { toast((e as Error).message, "bad"); } setBusy(false); }}
          onClose={() => setDeletingLink(null)} />
      )}
    </>
  );
}
