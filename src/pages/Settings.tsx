import { useEffect, useRef, useState } from "preact/hooks";
import { api, BrandingSettings, NdaListRow, WebhookConfig } from "../api";
import { fmtTime } from "../format";
import { appConfig, applyBrandTheme, t } from "../i18n";
import { BrandFeishu, BrandSlack, BrandZap, IconBan, IconCheck, IconLink, IconMail, IconPlus, IconPulse, IconSend, IconShield, IconTrash, IconUpload, IconUsers, IconX } from "../ui/icons";
import { Avatar, Badge, Card, Field, PageHeader, Switch, Tabs, toast } from "../ui/kit";
import { ConfirmDialog } from "./ConfirmDialog";

type TabId = "branding" | "webhooks" | "team" | "nda" | "mail" | "domains";

const COLOR_SWATCHES = ["#141413", "#1E3A8A", "#1D4ED8", "#0F5132", "#0F766E", "#9A3412", "#9F1239", "#334155"];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function BrandingTab() {
  const [form, setForm] = useState<BrandingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.settings().then((s) => setForm(s.branding)).catch((e) => toast(e.message, "bad"));
  }, []);

  if (!form) return <div class="panel"><div class="skel-row" /><div class="skel-row" /></div>;

  const onLogoFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 110_000) { toast(t("Logo image must be smaller than 100 KB"), "bad"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setForm({ ...form, logo_url: reader.result });
    };
    reader.readAsDataURL(file);
  };

  async function save(e: Event) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const { branding } = await api.saveBranding(form);
      setForm(branding);
      appConfig.appName = branding.app_name;
      appConfig.logoUrl = branding.logo_url;
      appConfig.ctaLabel = branding.cta_label;
      appConfig.ctaUrl = branding.cta_url;
      applyBrandTheme(branding.brand_color);
      toast(t("Branding saved"));
    } catch (err) {
      toast((err as Error).message, "bad");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} class="grid-2">
      <Card title={t("Your brand & reader button")} icon={<IconLink size={17} />}>
        <Field label={t("Company or workspace name")} hint={t("Shown at the top of your investor links and sign-in pages")} required>
          {(id, d) => <input id={id} aria-describedby={d} required maxLength={60} value={form.app_name} onInput={(e) => setForm({ ...form, app_name: e.currentTarget.value })} />}
        </Field>
        <Field label={t("Brand colour")}>
          {(id) => (
            <div class="color-row">
              <input id={id} type="color" class="color-input" value={form.brand_color} onInput={(e) => setForm({ ...form, brand_color: e.currentTarget.value })} />
              <div class="swatches">
                {COLOR_SWATCHES.map((hex) => (
                  <button key={hex} type="button" class={`swatch ${form.brand_color.toUpperCase() === hex ? "on" : ""}`} style={{ background: hex }} aria-label={hex} onClick={() => setForm({ ...form, brand_color: hex })} />
                ))}
              </div>
            </div>
          )}
        </Field>
        <Field label={t("Your logo (optional)")} hint={t("PNG, SVG or WebP under 100 KB. Square or horizontal mark works best.")}>
          {() => (
            <div class="row" style={{ gap: "10px", flexWrap: "wrap" }}>
              <input ref={logoRef} type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" class="sr" onChange={(e) => onLogoFile(e.currentTarget.files?.[0] ?? null)} />
              {form.logo_url && <img src={form.logo_url} alt="" style={{ height: "36px", maxWidth: "120px", objectFit: "contain", borderRadius: "6px", border: "1px solid var(--a-border)", padding: "4px", background: "#fff" }} />}
              <button type="button" class="btn btn-sm" onClick={() => logoRef.current?.click()}><IconUpload size={14} />{" "}{form.logo_url ? t("Change logo") : t("Upload logo")}</button>
              {form.logo_url && <button type="button" class="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, logo_url: null })}>{t("Remove")}</button>}
            </div>
          )}
        </Field>
        <hr style={{ border: 0, borderTop: "1px solid var(--a-border)", margin: "18px 0" }} />
        <Field label={t("Action button in reader (optional)")} hint={t("Let readers book a meeting or email you directly while viewing your deck")}>
          {(id, d) => <input id={id} aria-describedby={d} maxLength={40} placeholder={t("e.g. Book a 20-min call")} value={form.cta_label ?? ""} onInput={(e) => setForm({ ...form, cta_label: e.currentTarget.value || null })} />}
        </Field>
        <Field label={t("Button destination link (optional)")} hint={t("Paste your Calendly, Cal.com, or mailto:your@email.com link")}>
          {(id, d) => <input id={id} aria-describedby={d} maxLength={300} placeholder="https://cal.com/yourname" value={form.cta_url ?? ""} onInput={(e) => setForm({ ...form, cta_url: e.currentTarget.value || null })} />}
        </Field>
        <button class="btn btn-primary" disabled={busy}>{busy ? t("Saving…") : t("Save branding")}</button>
      </Card>

      <Card title={t("Live reader header preview")}>
        <p class="muted small" style={{ marginTop: 0 }}>{t("Preview of what recipients see at the top of your deck.")}</p>
        <div class="brand-preview">
          <div class="bp-left">
            {form.logo_url ? <img src={form.logo_url} alt="" style={{ width: 20, height: 20, objectFit: "contain", borderRadius: 4 }} /> : <span class="bp-dot" style={{ background: form.brand_color }} />}
            <b>{form.app_name || "SendFolio"}</b>
            <span class="bp-title">{t("Seed deck")}</span>
          </div>
          <div class="bp-right">
            {form.cta_label && form.cta_url && (
              <span class="bp-cta" style={{ background: form.brand_color }}>{form.cta_label}</span>
            )}
          </div>
        </div>
      </Card>
    </form>
  );
}

function WebhooksTab() {
  const [hooks, setHooks] = useState<WebhookConfig[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WebhookConfig["kind"]>("slack");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then((s) => setHooks(s.webhooks)).catch((e) => toast(e.message, "bad"));
  }, []);

  async function persist(next: WebhookConfig[]) {
    setBusy(true);
    try {
      const r = await api.saveWebhooks(next);
      setHooks(r.webhooks);
      toast(t("Alert channel saved"));
    } catch (e) { toast((e as Error).message, "bad"); }
    setBusy(false);
  }

  async function add(e: Event) {
    e.preventDefault();
    if (!hooks || !url.trim()) return;
    const item: WebhookConfig = {
      id: crypto.randomUUID().slice(0, 8),
      name: name.trim() || (kind === "slack" ? "Slack" : kind === "lark" ? "Lark / Feishu" : t("Custom app")),
      url: url.trim(),
      kind,
      enabled: true,
    };
    await persist([...hooks, item]);
    setName(""); setUrl("");
  }

  async function sendTest(h: WebhookConfig) {
    setBusy(true);
    try {
      const r = await api.testWebhook(h.url, h.kind);
      if (r.ok) toast(t("Test notification sent — check your chat!"));
      else toast(r.error ?? t("Could not reach that link. Double-check the URL."), "bad");
    } catch (e) { toast((e as Error).message, "bad"); }
    setBusy(false);
  }

  const placeholder = kind === "slack"
    ? "https://hooks.slack.com/services/T000/B000/XXXX"
    : kind === "lark"
      ? "https://open.feishu.cn/open-apis/bot/v2/hook/..."
      : "https://hooks.zapier.com/hooks/catch/...";

  return (
    <>
      <Card title={t("Get instant alerts in Slack or Feishu / Lark")} icon={<IconPulse size={17} />}>
        <p class="muted" style={{ marginTop: 0 }}>{t("Connect a chat channel to get a message the moment an investor opens your deck, forwards a link, or finishes reading.")}</p>

        <div class="field">
          <label>{t("Step 1: Choose where you want alerts")}</label>
          <div class="preset-grid" role="radiogroup" aria-label={t("Channel type")}>
            <button type="button" role="radio" aria-checked={kind === "slack"} class={`preset-card ${kind === "slack" ? "on" : ""}`} onClick={() => setKind("slack")}>
              <span class="brand-head"><BrandSlack size={18} /><b>Slack</b></span>
              <span>{t("Post live reading cards to any Slack channel")}</span>
            </button>
            <button type="button" role="radio" aria-checked={kind === "lark"} class={`preset-card ${kind === "lark" ? "on" : ""}`} onClick={() => setKind("lark")}>
              <span class="brand-head"><BrandFeishu size={18} /><b>{t("Feishu / Lark")}</b></span>
              <span>{t("Send interactive cards to a group chat bot")}</span>
            </button>
            <button type="button" role="radio" aria-checked={kind === "generic"} class={`preset-card ${kind === "generic" ? "on" : ""}`} onClick={() => setKind("generic")}>
              <span class="brand-head"><BrandZap size={18} /><b>{t("Other (Zapier / Make / n8n)")}</b></span>
              <span>{t("Connect to any automation tool")}</span>
            </button>
          </div>
        </div>

        <div class="guide-box">
          <b>{kind === "slack" ? t("How to get your Slack link (takes 1 minute):") : kind === "lark" ? t("How to get your Feishu / Lark bot link (takes 1 minute):") : t("How to connect Zapier, Make, or n8n:")}</b>
          {kind === "slack" ? (
            <ol>
              <li>{t("Open api.slack.com/apps → click “Create New App” → “From scratch” and pick your workspace.")}</li>
              <li>{t("In the left menu, click “Incoming Webhooks”, switch it On, and click “Add New Webhook to Workspace”.")}</li>
              <li>{t("Pick a channel (e.g. #fundraising), click Allow, then copy the link starting with https://hooks.slack.com/ and paste it below.")}</li>
            </ol>
          ) : kind === "lark" ? (
            <ol>
              <li>{t("Open the Feishu or Lark group chat where you want alerts (e.g. your fundraising group).")}</li>
              <li>{t("Click Settings (⋯) at the top right → “Bots” → “Add Bot” → “Custom Bot”.")}</li>
              <li>{t("Name it “SendFolio”, click Add, then copy the Webhook URL shown and paste it below.")}</li>
            </ol>
          ) : (
            <ol>
              <li>{t("In Zapier, Make, or n8n, create a new workflow with a “Webhook” trigger.")}</li>
              <li>{t("Copy the URL it gives you and paste it below.")}</li>
              <li>{t("After adding, click “Send test” so your automation tool can see a sample alert.")}</li>
            </ol>
          )}
        </div>

        <form onSubmit={add} class="webhook-form" style={{ marginTop: "14px" }}>
          <Field label={t("Step 2: Label this channel (optional)")}>
            {(id) => <input id={id} maxLength={60} placeholder={t("e.g. #fundraising")} value={name} onInput={(e) => setName(e.currentTarget.value)} />}
          </Field>
          <Field label={t("Step 3: Paste the link here")} required>
            {(id) => <input id={id} required type="text" placeholder={placeholder} value={url} onInput={(e) => setUrl(e.currentTarget.value)} />}
          </Field>
          <button class="btn btn-primary" disabled={busy || !url.trim()}><IconPlus size={15} />{" "}{t("Connect channel")}</button>
        </form>
      </Card>

      {hooks && hooks.length > 0 && (
        <Card title={t("Connected channels")} pad={false}>
          <div class="table-wrap"><table class="dtable">
            <thead><tr><th>{t("Channel")}</th><th>{t("App")}</th><th>{t("Status")}</th><th /></tr></thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id}>
                  <td>
                    <b>{h.name}</b>
                    <span class="cell-sub mono" title={h.url}>{h.url.slice(0, 48)}{h.url.length > 48 ? "…" : ""}</span>
                  </td>
                  <td><Badge tone="info">{h.kind === "slack" ? "Slack" : h.kind === "lark" ? t("Feishu / Lark") : t("Custom")}</Badge></td>
                  <td>
                    <Switch label="" checked={h.enabled} onChange={(v) => persist(hooks.map((x) => x.id === h.id ? { ...x, enabled: v } : x))} />
                  </td>
                  <td class="actions">
                    <button type="button" class="btn btn-sm" disabled={busy} onClick={() => sendTest(h)}><IconSend size={14} />{" "}{t("Send test")}</button>{" "}
                    <button type="button" class="icon-btn" aria-label={t("Delete")} onClick={() => persist(hooks.filter((x) => x.id !== h.id))}><IconTrash size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}

function TeamTab() {
  const [primary, setPrimary] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then((s) => {
      setPrimary(s.primary_admins);
      setExtras(s.extra_admins);
      setLoaded(true);
    }).catch((e) => toast(e.message, "bad"));
  }, []);

  async function saveList(next: string[], msg: string) {
    setBusy(true);
    try {
      const r = await api.saveAdmins(next);
      setExtras(r.extra_admins);
      toast(msg);
    } catch (e) { toast((e as Error).message, "bad"); }
    setBusy(false);
  }

  async function addMember(e: Event) {
    e.preventDefault();
    const em = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) { toast(t("Please enter a valid email address"), "bad"); return; }
    if (primary.includes(em) || extras.includes(em)) { toast(t("This person is already an admin"), "bad"); return; }
    await saveList([...extras, em], t("Teammate added"));
    setNewEmail("");
  }

  return (
    <Card title={t("Team & co-founders")} icon={<IconUsers size={17} />}>
      <p class="muted" style={{ marginTop: 0 }}>{t("Anyone on this list can sign in to the dashboard with their own email code and receive investor reading alerts.")}</p>

      <form onSubmit={addMember} class="inline-add-bar">
        <input type="email" required placeholder={t("Enter a teammate's email, e.g. cofounder@company.com")} value={newEmail} disabled={!loaded || busy} onInput={(e) => setNewEmail(e.currentTarget.value)} />
        <button class="btn btn-primary" disabled={!loaded || busy || !newEmail.trim()}><IconPlus size={15} />{" "}{t("Add teammate")}</button>
      </form>

      <ul class="member-list">
        {primary.map((em) => (
          <li key={em}>
            <Avatar name={em} size={34} />
            <div class="member-info">
              <b>{em}</b>
              <span class="muted">{t("Primary owner (set in server config)")}</span>
            </div>
            <Badge tone="ok">{t("Owner")}</Badge>
          </li>
        ))}
        {extras.map((em) => (
          <li key={em}>
            <Avatar name={em} size={34} />
            <div class="member-info">
              <b>{em}</b>
              <span class="muted">{t("Full admin access & alerts")}</span>
            </div>
            <Badge tone="info">{t("Admin")}</Badge>
            <button type="button" class="icon-btn" disabled={busy} aria-label={t("Remove")} title={t("Remove")} onClick={() => saveList(extras.filter((x) => x !== em), t("Teammate removed"))}>
              <IconX size={15} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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
      <Card title={t("NDA versions")} icon={<IconShield size={17} />} action={!form && <button class="btn btn-sm" onClick={startNew}><IconPlus size={15} />{" "}{t("New NDA version")}</button>} pad={false}>
        <p class="muted" style={{ margin: "8px 20px 4px" }}>{t("Once a visitor accepts the current NDA, they will not be asked to sign it again unless you publish a new version.")}</p>
        {ndas && (
          <div class="table-wrap"><table class="dtable">
            <thead><tr><th>{t("Version")}</th><th>{t("Status")}</th><th>{t("Created")}</th><th /></tr></thead>
            <tbody>
              {ndas.map((n) => (
                <tr key={n.id}>
                  <td>
                    <b>{n.label}</b>
                    <span class="cell-sub mono" title={`SHA-256: ${n.sha256}`}>{t("Fingerprint")}: {n.sha256.slice(0, 12)}…</span>
                  </td>
                  <td>{n.active ? <Badge tone="ok">{t("Current")}</Badge> : <Badge>{t("Earlier")}</Badge>}</td>
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
            <Field label={t("Chinese text")} hint={t("Leave an empty line between paragraphs. Wrap words in **double stars** to make them bold.")} required>{(id, d) => <textarea id={id} aria-describedby={d} rows={10} required value={form.zh} onInput={(e) => setForm({ ...form, zh: e.currentTarget.value })} />}</Field>
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

  const status = (ok: boolean) => ok ? <Badge tone="ok" icon={<IconCheck size={12} />}>{t("Ready")}</Badge> : <Badge tone="bad" icon={<IconX size={12} />}>{t("Missing")}</Badge>;
  return (
    <>
      <Card title={t("Send yourself a test email")} icon={<IconSend size={17} />}>
        <p class="muted" style={{ marginTop: 0 }}>{t("Make sure your verification codes arrive in the inbox instead of spam. Try your work email and a personal Gmail or Outlook.")}</p>
        <form class="inline-add-bar" onSubmit={async (e) => {
          e.preventDefault();
          if (!to.trim()) return;
          setBusy(true); setResults(null);
          try { setResults((await api.mailTest(to.split(/[\s,;，；]+/).filter(Boolean))).results); } catch (err) { toast((err as Error).message, "bad"); }
          setBusy(false);
        }}>
          <input type="text" placeholder={t("Enter an email address (or several separated by commas)")} value={to} onInput={(e) => setTo(e.currentTarget.value)} />
          <button class="btn btn-primary" disabled={busy || !to.trim()}><IconMail size={15} />{" "}{t("Send test")}</button>
        </form>
        {results && <ul class="todo" style={{ marginTop: "14px" }}>{results.map((r) => <li key={r.to}>{r.ok ? <IconCheck size={16} /> : <IconX size={16} />}<span>{r.ok ? t("Sent") : t("Failed")} · {r.to}{r.error && <span class="muted"> · {r.error}</span>}</span></li>)}</ul>}
      </Card>

      <Card title={t("Spam-protection check (optional)")} icon={<IconMail size={17} />} action={
        <button class="btn btn-sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setCheck(await api.mailCheck(selector.trim() || undefined)); } catch (e) { toast((e as Error).message, "bad"); }
          setBusy(false);
        }}>{t("Run check")}</button>
      } pad={false}>
        <p class="muted" style={{ margin: "8px 20px 12px" }}>{t("Checks whether your sending domain has the standard anti-spam records set up so investor login codes land in the inbox.")}</p>
        {check ? (
          <div class="table-wrap"><table class="dtable"><tbody>
            <tr><td><b>{t("Sender permission (SPF)")}</b><span class="cell-sub">{t("Tells Gmail & Outlook your server is allowed to send")}</span></td><td>{status(check.spf.length > 0)}</td></tr>
            <tr><td><b>{t("Anti-spoofing rule (DMARC)")}</b><span class="cell-sub">{t("Protects your domain and improves inbox placement")}</span></td><td>{status(check.dmarc.length > 0)}</td></tr>
            <tr><td><b>{t("Incoming mail (MX)")}</b><span class="cell-sub">{t("Allows replies to your sending domain")}</span></td><td>{status(check.mx.length > 0)}</td></tr>
            <tr><td><b>{t("Email signature (DKIM)")}</b><span class="cell-sub">{t("Optional digital signature from your email provider")}</span></td><td>{check.dkim ? status(check.dkim.records.length > 0) : <Badge>{t("Not checked")}</Badge>}</td></tr>
          </tbody></table></div>
        ) : null}
        {check && check.notes.length > 0 && <ul class="todo" style={{ margin: "12px 20px 20px" }}>{check.notes.map((n) => <li key={n}><span>{n}</span></li>)}</ul>}
        <details class="adv-details" style={{ margin: "12px 20px 18px" }}>
          <summary>{t("Advanced: check DKIM selector")}</summary>
          <div class="adv-body" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input aria-label={t("DKIM selector")} placeholder={t("e.g. resend or google")} value={selector} onInput={(e) => setSelector(e.currentTarget.value)} style={{ maxWidth: "260px" }} />
            <button type="button" class="btn btn-sm" disabled={busy || !selector.trim()} onClick={async () => {
              setBusy(true);
              try { setCheck(await api.mailCheck(selector.trim())); } catch (e) { toast((e as Error).message, "bad"); }
              setBusy(false);
            }}>{t("Check DKIM")}</button>
          </div>
        </details>
      </Card>
    </>
  );
}

function DomainsTab() {
  const [list, setList] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then((s) => { setList(s.personal_email_domains); setLoaded(true); }).catch((e) => toast(e.message, "bad"));
  }, []);

  async function saveDomains(next: string[], msg: string) {
    setBusy(true);
    try {
      await api.savePersonalDomains(next);
      setList(next);
      toast(msg);
    } catch (err) { toast((err as Error).message, "bad"); }
    setBusy(false);
  }

  async function addDomain(e: Event) {
    e.preventDefault();
    const cleaned = input.trim().toLowerCase().replace(/^.*@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!cleaned || !cleaned.includes(".")) { toast(t("Please enter a valid domain like gmail.com"), "bad"); return; }
    if (list.includes(cleaned)) { toast(t("Already on the list"), "bad"); setInput(""); return; }
    await saveDomains([cleaned, ...list], t("Domain added"));
    setInput("");
  }

  const shown = list.filter((d) => !filter.trim() || d.includes(filter.trim().toLowerCase()));

  return (
    <Card title={t("Personal email providers to block")} icon={<IconBan size={17} />}>
      <p class="muted" style={{ marginTop: 0 }}>{t("When a link requires a work email, addresses from these providers are automatically asked to use a company email instead.")}</p>

      <form onSubmit={addDomain} class="inline-add-bar">
        <input type="text" placeholder={t("Add a domain, e.g. icloud.com")} value={input} disabled={!loaded || busy} onInput={(e) => setInput(e.currentTarget.value)} />
        <button class="btn btn-primary" disabled={!loaded || busy || !input.trim()}><IconPlus size={15} />{" "}{t("Add domain")}</button>
      </form>

      {list.length > 10 && (
        <div style={{ marginBottom: "12px" }}>
          <input type="search" placeholder={t("Filter {0} blocked domains…", list.length)} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} style={{ maxWidth: "300px" }} />
        </div>
      )}

      <div class="domain-pills">
        {shown.map((d) => (
          <span key={d} class="domain-pill">
            <span>{d}</span>
            <button type="button" disabled={busy} aria-label={t("Remove")} onClick={() => saveDomains(list.filter((x) => x !== d), t("Domain removed"))}>
              <IconX size={12} />
            </button>
          </span>
        ))}
        {loaded && shown.length === 0 && <span class="muted small">{t("No matching domains.")}</span>}
      </div>
    </Card>
  );
}

export function Settings() {
  const [tab, setTab] = useState<TabId>("branding");
  return (
    <>
      <PageHeader title={t("Settings")} subtitle={t("Customize your brand, connect chat alerts, invite teammates, and manage your NDA.")} />
      <Tabs label={t("Settings sections")} value={tab} onChange={setTab} tabs={[
        { id: "branding", label: t("Branding") },
        { id: "webhooks", label: t("Alerts") },
        { id: "team", label: t("Team") },
        { id: "nda", label: t("NDA") },
        { id: "mail", label: t("Email delivery") },
        { id: "domains", label: t("Blocked emails") },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "branding" && <BrandingTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "team" && <TeamTab />}
        {tab === "nda" && <NdaTab />}
        {tab === "mail" && <MailTab />}
        {tab === "domains" && <DomainsTab />}
      </div>
    </>
  );
}
