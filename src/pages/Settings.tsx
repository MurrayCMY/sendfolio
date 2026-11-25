import { useEffect, useState } from "preact/hooks";
import { api, NdaListRow } from "../api";
import { fmtTime } from "../format";
import { IconCheck, IconMail, IconBan, IconPlus, IconSend, IconShield, IconX } from "../ui/icons";
import { Badge, Card, EmptyState, Field, PageHeader, Tabs, toast } from "../ui/kit";
import { ConfirmDialog } from "./ConfirmDialog";
import { t } from "../i18n";

type TabId = "nda" | "mail" | "domains";

function NdaTab() {
  const [ndas, setNdas] = useState<NdaListRow[] | null>(null);
  const [form, setForm] = useState<{ label: string; zh: string; en: string } | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [activateTarget, setActivateTarget] = useState<NdaListRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.ndaVersions().then((r) => setNdas(r.versions)).catch((e) => toast(e.message, "bad"));
  };
  useEffect(load, []);

  async function startNew() {
    const active = ndas?.find((n) => n.active);
    const base = active ? await api.ndaVersion(active.id) : null;
    setForm({ label: "", zh: base?.body_zh ?? "", en: base?.body_en ?? "" });
  }

  return (
    <>
      <Card title={t("NDA versions")} icon={<IconShield size={17} />} action={!form && <button class="btn btn-sm" onClick={startNew}><IconPlus size={15} />{" "}{t("Upload new version")}</button>} pad={false}>
        <p class="muted" style={{ margin: "8px 20px 4px" }}>{t("Each signature records a hash of the full text of the version signed. Once an email address has accepted the current version it is not asked again.")}</p>
        {ndas && (
          <div class="table-wrap"><table class="dtable">
            <thead><tr><th>{t("Version")}</th><th>{t("Status")}</th><th>{t("Text hash (SHA-256)")}</th><th>{t("Created")}</th><th /></tr></thead>
            <tbody>
              {ndas.map((n) => (
                <tr key={n.id}>
                  <td><b>{n.label}</b></td>
                  <td>{n.active ? <Badge tone="ok">{t("Current")}</Badge> : <Badge>{t("Earlier")}</Badge>}</td>
                  <td class="mono">{n.sha256.slice(0, 16)}…</td>
                  <td class="tnum">{fmtTime(n.created_at)}</td>
                  <td class="actions">{!n.active && <button class="btn-link" onClick={() => setActivateTarget(n)}>{t("Make current")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {form && (
          <form class="panel-body" style={{ borderTop: "1px solid var(--a-border)" }} onSubmit={(e) => { e.preventDefault(); setConfirmCreate(true); }}>
            <Field label={t("Version name")} required>{(id) => <input id={id} required placeholder={t("e.g. v3 (2027-01-10)")} value={form.label} onInput={(e) => setForm({ ...form, label: e.currentTarget.value })} />}</Field>
            <Field label={t("Chinese text")} hint={t("Blank line = new paragraph, **bold**")} required>{(id, d) => <textarea id={id} aria-describedby={d} rows={10} required value={form.zh} onInput={(e) => setForm({ ...form, zh: e.currentTarget.value })} />}</Field>
            <Field label={t("English text")} required>{(id) => <textarea id={id} rows={10} required value={form.en} onInput={(e) => setForm({ ...form, en: e.currentTarget.value })} />}</Field>
            <div style={{ display: "flex", gap: "10px" }}>
              <button type="button" class="btn" onClick={() => setForm(null)}>{t("Cancel")}</button>
              <button class="btn btn-primary">{t("Save and make current")}</button>
            </div>
          </form>
        )}
      </Card>

      {confirmCreate && form && (
        <ConfirmDialog
          title={t("Make the new version the current NDA?")}
          body={t("The new version becomes current immediately and later visitors sign it. Existing signatures are unaffected and keep the hash of the version they signed.")}
          confirmLabel={t("Save and make current")}
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.createNda(form.label, form.zh, form.en); toast(t("New version saved")); setForm(null); load(); }
            catch (err) { toast((err as Error).message, "bad"); }
            setConfirmCreate(false);
            setBusy(false);
          }}
          onClose={() => setConfirmCreate(false)}
        />
      )}
      {activateTarget && (
        <ConfirmDialog
          title={t("Switch the current NDA to {0}?", activateTarget.label)}
          body={t("Later visitors will sign this version; existing signatures are unaffected.")}
          confirmLabel={t("Make current")}
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await api.activateNda(activateTarget.id); toast(t("Switched")); load(); }
            catch (err) { toast((err as Error).message, "bad"); }
            setActivateTarget(null);
            setBusy(false);
          }}
          onClose={() => setActivateTarget(null)}
        />
      )}
    </>
  );
}

function MailTab() {
  const [selector, setSelector] = useState("");
  const [check, setCheck] = useState<Awaited<ReturnType<typeof api.mailCheck>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [results, setResults] = useState<{ to: string; ok: boolean; error?: string }[] | null>(null);

  const status = (ok: boolean) => ok ? <Badge tone="ok" icon={<IconCheck size={12} />}>{t("Configured")}</Badge> : <Badge tone="bad" icon={<IconX size={12} />}>{t("Missing")}</Badge>;
  return (
    <>
      <Card title={t("Sending domain check")} icon={<IconMail size={17} />} action={
        <div class="filter-row">
          <input aria-label={t("DKIM selector")} placeholder={t("DKIM selector (optional)")} value={selector} onInput={(e) => setSelector(e.currentTarget.value)} style={{ width: "220px" }} />
          <button class="btn btn-sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try { setCheck(await api.mailCheck(selector.trim() || undefined)); } catch (e) { toast((e as Error).message, "bad"); }
            setBusy(false);
          }}>{t("Check DNS")}</button>
        </div>
      } pad={false}>
        <p class="muted" style={{ margin: "8px 20px 4px" }}>{t("Checks MX, SPF, DKIM, DMARC and the domain of this site. The DKIM selector is in your mail provider's domain settings.")}</p>
        {check ? (
          <div class="table-wrap"><table class="dtable"><tbody>
            <tr><td><b>{t("MX (incoming mail)")}</b></td><td>{status(check.mx.length > 0)}</td><td class="mono">{check.mx.join("  ·  ") || "—"}</td></tr>
            <tr><td><b>SPF</b></td><td>{status(check.spf.length > 0)}</td><td class="mono">{check.spf.join(" ") || "—"}</td></tr>
            <tr><td><b>DKIM</b></td><td>{check.dkim ? status(check.dkim.records.length > 0) : <Badge>{t("Not checked")}</Badge>}</td><td class="mono">{check.dkim ? check.dkim.records.join(" ").slice(0, 90) || "—" : t("Enter a selector to check")}</td></tr>
            <tr><td><b>DMARC</b></td><td>{status(check.dmarc.length > 0)}</td><td class="mono">{check.dmarc.join(" ") || "—"}</td></tr>
            <tr><td><b>{check.docs.host}</b></td><td>{status(check.docs.cname.length > 0)}</td><td class="mono">{check.docs.cname.join(" ") || t("No CNAME (it may be an A record, managed by your host)")}</td></tr>
          </tbody></table></div>
        ) : <p class="muted" style={{ margin: "8px 20px 20px" }}>{t("Click “Check DNS” at the top right.")}</p>}
        {check && check.notes.length > 0 && <ul class="todo" style={{ margin: "0 20px 20px" }}>{check.notes.map((n) => <li key={n}><span>{n}</span></li>)}</ul>}
      </Card>

      <Card title={t("Send test emails")} icon={<IconSend size={17} />}>
        <p class="muted" style={{ marginTop: 0 }}>{t("One address per line, up to 5 at a time and 15 per hour. Try a mix of providers (Gmail, Outlook, a company mailbox) and check that nothing lands in spam.")}</p>
        <Field label={t("Recipients")}>{(id) => <textarea id={id} rows={4} placeholder="someone@qq.com" value={to} onInput={(e) => setTo(e.currentTarget.value)} />}</Field>
        <button class="btn btn-primary" disabled={busy || !to.trim()} onClick={async () => {
          setBusy(true); setResults(null);
          try { setResults((await api.mailTest(to.split(/[\s,;，；]+/).filter(Boolean))).results); } catch (e) { toast((e as Error).message, "bad"); }
          setBusy(false);
        }}><IconMail size={16} />{" "}{t("Send test emails")}</button>
        {results && <ul class="todo" style={{ marginTop: "14px" }}>{results.map((r) => <li key={r.to}>{r.ok ? <IconCheck size={16} /> : <IconX size={16} />}<span>{r.ok ? t("Sent") : t("Failed")} · {r.to}{r.error && <span class="muted"> · {r.error}</span>}</span></li>)}</ul>}
      </Card>
    </>
  );
}

function DomainsTab() {
  const [domains, setDomains] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { api.settings().then((s) => { setDomains(s.personal_email_domains.join("\n")); setLoaded(true); }).catch((e) => toast(e.message, "bad")); }, []);
  return (
    <Card title={t("Personal email domain blocklist")} icon={<IconBan size={17} />}>
      <p class="muted" style={{ marginTop: 0 }}>{t("Links with “Reject personal email addresses” turned on block these domains. One per line.")}</p>
      <Field label={t("Domain list")}>{(id) => <textarea id={id} rows={14} disabled={!loaded} value={domains} onInput={(e) => setDomains(e.currentTarget.value)} />}</Field>
      <button class="btn btn-primary" onClick={async () => {
        try { await api.savePersonalDomains(domains.split(/[\s,;，；]+/).filter(Boolean)); toast(t("Saved")); } catch (err) { toast((err as Error).message, "bad"); }
      }}>{t("Save")}</button>
    </Card>
  );
}

export function Settings() {
  const [tab, setTab] = useState<TabId>("nda");
  return (
    <>
      <PageHeader title={t("NDA & settings")} subtitle={t("NDA versions, mail checks and the personal email blocklist. Signing records are under “Visitors”.")} />
      <Tabs label={t("Settings sections")} value={tab} onChange={setTab} tabs={[
        { id: "nda", label: t("NDA versions") }, { id: "mail", label: t("Email & domain") }, { id: "domains", label: t("Email blocklist") },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "nda" && <NdaTab />}
        {tab === "mail" && <MailTab />}
        {tab === "domains" && <DomainsTab />}
      </div>
    </>
  );
}
