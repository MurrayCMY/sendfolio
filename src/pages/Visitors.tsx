import { useEffect, useRef, useState } from "preact/hooks";
import { api, VisitorSummary } from "../api";
import { Link, navigate } from "../app";
import { fmtDur, fmtRelative, fmtTime, intentOf, intentReason, visitorStatus, visitorStatusList } from "../format";
import { IconArrowLeft, IconBan, IconCalendar, IconClock, IconEye, IconNote, IconSearch, IconSend, IconShield, IconSort, IconTrash, IconTrending, IconUser, IconUsers } from "../ui/icons";
import { Badge, Card, EmptyState, Menu, PageHeader, StatCard, Tabs, toast } from "../ui/kit";
import { Acceptances } from "./Acceptances";
import { ConfirmDialog } from "./ConfirmDialog";
import { VisitTable } from "./VisitTable";
import { t } from "../i18n";

const STATUS_ICON: Record<string, any> = {
  new: <IconUser size={15} />, contacted: <IconSend size={15} />, meeting: <IconCalendar size={15} />, declined: <IconBan size={15} />,
};

/** Segmented picker for the follow-up status. */
export function StatusPicker({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  const cur = value ?? "new";
  return (
    <div class="segmented" role="radiogroup" aria-label={t("Follow-up status")}>
      {visitorStatusList().map((s) => (
        <button key={s.key} type="button" role="radio" aria-checked={cur === s.key} class={cur === s.key ? "on" : ""} onClick={() => onChange(s.key)}>
          {STATUS_ICON[s.key]} {s.label}
        </button>
      ))}
    </div>
  );
}

export function IntentBadge({ v }: { v: { visits: number; depth?: number; total_ms: number } }) {
  const i = intentOf(v);
  if (!i) return null;
  return (
    <span class={`badge has-icon ${i === "hot" ? "badge-hot" : "badge-info"}`} title={intentReason(v)}>
      <IconTrending size={12} /> {i === "hot" ? t("High interest") : t("Worth watching")}
    </span>
  );
}

type SortKey = "last" | "visits" | "time" | "depth";
const sorts = (): { key: SortKey; label: string }[] => [
  { key: "last", label: t("Last visit") }, { key: "visits", label: t("Visits") }, { key: "time", label: t("Total time") }, { key: "depth", label: t("Reading depth") },
];

function VisitorList() {
  const [rows, setRows] = useState<VisitorSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("last");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api.visitors().then((r) => setRows(r.visitors)).catch((e) => setError(e.message)); }, []);
  // "/" jumps to the search box, like most admin tools.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const q = query.trim().toLowerCase();
  const key = (v: VisitorSummary) =>
    sort === "visits" ? v.visits : sort === "time" ? v.total_ms : sort === "depth" ? v.depth ?? 0 : v.last_at ? new Date(v.last_at).getTime() : 0;
  const shown = (rows ?? [])
    .filter((v) => (!q || v.name.toLowerCase().includes(q) || v.email.toLowerCase().includes(q)) && (status === "all" || (v.status ?? "new") === status))
    .sort((a, b) => key(b) - key(a));
  const count = (s: string) => (rows ?? []).filter((v) => (v.status ?? "new") === s).length;

  return (
    <>
      {error && <p class="field-error" role="alert">{error}</p>}
      {rows && rows.length > 0 && (
        <div class="toolbar" style={{ flexWrap: "wrap", gap: "12px" }}>
          <label class="search"><IconSearch size={16} /><input ref={searchRef} type="search" aria-label={t("Search visitors")} placeholder={t("Search name or email (press /)")} value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
          <div class="chips" role="group" aria-label={t("Filter by follow-up status")}>
            <button class={`chip ${status === "all" ? "on" : ""}`} onClick={() => setStatus("all")}>{t("All {0}", rows.length)}</button>
            {visitorStatusList().map((s) => (
              <button key={s.key} class={`chip ${status === s.key ? "on" : ""}`} onClick={() => setStatus(s.key)}>{STATUS_ICON[s.key]} {s.label} {count(s.key)}</button>
            ))}
          </div>
        </div>
      )}
      <div class="panel">
        {rows === null ? <><div class="skel-row" /><div class="skel-row" /><div class="skel-row" /></> : rows.length === 0 ? (
          <EmptyState icon={<IconUsers />} title={t("No visitors yet")} body={t("Send a link to someone. Once they verify their identity they appear here, and you can note your follow-up.")} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<IconSearch />} title={t("No matching visitors")} body={t("Try another keyword or clear the filters.")} />
        ) : (
          <div class="table-wrap"><table class="dtable">
            <thead>
              <tr>
                <th>{t("Visitors")}</th>
                <th>{t("Documents read")}</th>
                <th>{t("Follow-up")}</th>
                {sorts().map((s) => (
                  <th key={s.key} class={s.key === "last" ? "" : "right"} aria-sort={sort === s.key ? "descending" : "none"}>
                    <button class={`sortbtn ${sort === s.key ? "on" : ""}`} onClick={() => setSort(s.key)}>{s.label}<IconSort size={13} /></button>
                  </th>
                ))}
                <th>NDA</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const st = visitorStatus(v.status);
                return (
                  <tr key={v.id}>
                    <td class="clip">
                      <Link href={`/admin/visitors/${v.id}`}>{v.name}</Link> <IntentBadge v={v} />
                      <span class="cell-sub">{v.email}{v.note ? ` · ${v.note}` : ""}</span>
                    </td>
                    <td class="clip" title={(v.docs ?? []).join(t(", "))}>
                      <span class="ell">{(v.docs ?? []).length === 0 ? "—" : v.docs![0]}</span>
                      {(v.docs ?? []).length > 1 && <span class="cell-sub">{t("{0} more documents", v.docs!.length - 1)}</span>}
                    </td>
                    <td class="nw"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td class="nw"><span title={fmtTime(v.last_at)}>{fmtRelative(v.last_at)}</span></td>
                    <td class="right tnum">{v.visits}</td>
                    <td class="right tnum nw">{fmtDur(v.total_ms)}</td>
                    <td class="right tnum">{Math.round((v.depth ?? 0) * 100)}%</td>
                    <td class="nw">{v.nda_signed ? <Badge tone="ok">{t("Signed")}</Badge> : <Badge>{t("Not signed")}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

export function Visitors() {
  const [tab, setTab] = useState<"people" | "nda">("people");
  return (
    <>
      <PageHeader title={t("Visitors")} subtitle={t("Everyone's reading across all documents and links, grouped by email, plus your follow-up notes.")} />
      <Tabs label={t("Visitor views")} value={tab} onChange={setTab} tabs={[{ id: "people", label: t("Visitors") }, { id: "nda", label: t("NDA signing records") }]} />
      {tab === "people" ? <VisitorList /> : <Acceptances />}
    </>
  );
}

type Detail = Awaited<ReturnType<typeof api.visitor>>;

export function VisitorDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { api.visitor(id).then((d) => { setData(d); setNote(d.visitor.note ?? ""); }).catch((e) => setError(e.message)); }, [id, reloadKey]);

  if (error) return <p class="field-error" role="alert">{error}</p>;
  if (!data) return <div class="panel"><div class="skel-row" /><div class="skel-row" /></div>;
  const { visitor, visits, acceptances } = data;
  const total = visits.reduce((a, v) => a + v.total_active_ms, 0);
  const depth = Math.max(0, ...visits.map((v) => (v.page_count ? v.max_page / v.page_count : 0)));
  const summary = { visits: visits.length, depth, total_ms: total };

  async function save(patch: { status?: string; note?: string }) {
    try {
      await api.updateVisitor(id, patch);
      setData((d) => d && { ...d, visitor: { ...d.visitor, ...(patch.status !== undefined ? { status: patch.status === "new" ? null : patch.status } : {}), ...(patch.note !== undefined ? { note: patch.note || null } : {}) } });
      toast(t("Saved"));
    } catch (e) { toast((e as Error).message, "bad"); }
  }

  return (
    <>
      <PageHeader
        back={<Link href="/admin/visitors"><IconArrowLeft size={15} />{" "}{t("All visitors")}</Link>}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>{visitor.name} <IntentBadge v={summary} /></span>}
        subtitle={visitor.email}
        meta={<span class="muted">{t("First seen {0}{1}", fmtTime(visitor.first_seen_at), intentOf(summary) ? ` · ${intentReason(summary)}` : "")}</span>}
        actions={<Menu label={t("More actions")} items={[{ label: t("Delete this visitor…"), icon: <IconTrash size={16} />, danger: true, onClick: () => setDeleting(true) }]} />}
      />
      <Card title={t("Follow-up")} icon={<IconNote size={17} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <StatusPicker value={visitor.status} onChange={(s) => save({ status: s })} />
          <div>
            <label class="login-label" for="visitor-note">{t("Note (only you can see this)")}</label>
            <textarea id="visitor-note" class="note-area" maxLength={500} placeholder={t("e.g. Call booked for Friday; interested in valuation and roadmap")}
              value={note} onInput={(e) => setNote(e.currentTarget.value)}
              onBlur={() => { if (note.trim() !== (visitor.note ?? "")) save({ note }); }} />
            <p class="muted small" style={{ margin: "4px 0 0" }}>{t("Saved automatically when you leave the box.")}</p>
          </div>
        </div>
      </Card>
      <div class="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <StatCard icon={<IconEye size={15} />} label={t("Visits")} value={visits.length} />
        <StatCard icon={<IconClock size={15} />} label={t("Total active reading")} value={total ? fmtDur(total) : "—"} hint={t("Furthest reached {0}%", Math.round(depth * 100))} />
        <StatCard icon={<IconShield size={15} />} label="NDA" value={acceptances.length ? t("Signed") : t("Not signed")} hint={acceptances[0] ? acceptances[0].nda_label : undefined} />
      </div>
      <Card title={t("Visits across all documents and links")} icon={<IconEye size={17} />} pad={false}>
        <VisitTable visits={visits} show={{ doc: true, link: true }} onDelete={async (ids) => { await api.deleteVisits(ids); setReloadKey((k) => k + 1); }} />
      </Card>
      <Card title={t("NDA signing records")} icon={<IconShield size={17} />}>
        {acceptances.length === 0 ? <p class="muted" style={{ margin: 0 }}>{t("Not signed yet.")}</p> : (
          <ul class="todo">{acceptances.map((a) => <li key={a.id}><Badge tone="ok">{a.nda_label}</Badge><span>{t("{0} · via “{1}”", fmtTime(a.accepted_at), a.link_name ?? t("Deleted link"))}</span></li>)}</ul>
        )}
      </Card>
      {deleting && (
        <ConfirmDialog
          title={t("Delete visitor “{0}”?", visitor.name)}
          body={<>{t("Use this when someone asks you to erase their personal data, or to clean up test data. This will ")}<b>{t("Permanently delete")}</b>{t(": {0} visit records with per-page reading times, {1} NDA signing records (including signed PDFs), your note, unused codes and the visitor. This ", visits.length, acceptances.length)}<b>{t("cannot be undone")}</b>{t(", and you will no longer be able to prove they signed an NDA.")}</>}
          confirmLabel={t("Permanently delete all data")}
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.deleteVisitor(id); toast(t("Visitor and data deleted")); navigate("/admin/visitors"); }
            catch (e) { toast((e as Error).message, "bad"); setDeleting(false); setBusy(false); }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}
