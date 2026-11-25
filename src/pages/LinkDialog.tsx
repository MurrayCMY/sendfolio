import { useId, useState } from "preact/hooks";
import { api, LinkInput, LinkRow, VersionRow } from "../api";
import { Modal } from "../ui/Modal";
import { Field, Switch, toast } from "../ui/kit";
import { IconCheck, IconPlus, IconRefresh } from "../ui/icons";
import { t } from "../i18n";

type Mode = "create" | "edit" | "clone";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const wmFieldList = (): { id: string; label: string; sample: string }[] => [
  { id: "name", label: t("Visitor's name"), sample: t("Jane Doe") },
  { id: "email", label: t("Email"), sample: "jane.doe@example.com" },
  { id: "ip", label: t("IP address"), sample: "203.0.113.7" },
  { id: "date", label: t("Visit date"), sample: "2026-11-24" },
  { id: "datetime", label: t("Date and time"), sample: "2026-11-24 15:30" },
];

const randomSlug = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"[b % 57]).join("");

/** Create a link, edit one, or create a new one from an existing link's settings ("clone"). */
export function LinkDialog(props: {
  docId: string;
  versions: VersionRow[];
  mode: Mode;
  initial?: LinkRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const i = props.initial;
  const uid = useId();
  const editing = props.mode === "edit";
  const [name, setName] = useState(props.mode === "clone" ? "" : i?.name ?? "");
  const [slug, setSlug] = useState(editing ? i?.slug ?? "" : "");
  const [pinned, setPinned] = useState(i?.pinned_version_id ?? "");
  const [expires, setExpires] = useState(toLocalInput(i?.expires_at ?? null));
  const [requireEmail, setRequireEmail] = useState(i?.require_email ?? true);
  const [requireOtp, setRequireOtp] = useState(i?.require_otp ?? true);
  const [blockPersonal, setBlockPersonal] = useState(i?.block_personal_email ?? true);
  const [domains, setDomains] = useState((i?.allowed_domains ?? []).join(", "));
  const [requireNda, setRequireNda] = useState(i?.require_nda ?? true);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [allowDownload, setAllowDownload] = useState(i?.allow_download ?? false);
  const [watermark, setWatermark] = useState(i?.watermark ?? true);
  const [wmFields, setWmFields] = useState<string[]>(i?.watermark_fields ?? ["email", "date"]);
  const [wmText, setWmText] = useState(i?.watermark_text ?? "");
  const [notify, setNotify] = useState(i?.notify_on_open ?? true);
  const [enabled, setEnabled] = useState(i?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleField = (id: string) => setWmFields((cur) => {
    let next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (id === "date" && next.includes("date")) next = next.filter((x) => x !== "datetime");
    if (id === "datetime" && next.includes("datetime")) next = next.filter((x) => x !== "date");
    return next;
  });
  const preview = [wmText.trim(), ...wmFieldList().filter((f) => wmFields.includes(f.id)).map((f) => f.sample)].filter(Boolean).join(" · ") || t("Confidential");
  const guessable = slug.trim().length > 0 && !(requireEmail && requireOtp) && !password && !(i?.has_password && !clearPassword);
  const hasPassword = !!password || (!!i?.has_password && !clearPassword);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const input: LinkInput = {
      name,
      pinned_version_id: pinned || null,
      expires_at: expires ? new Date(expires).toISOString() : null,
      require_email: requireEmail,
      require_otp: requireOtp,
      block_personal_email: blockPersonal,
      allowed_domains: domains.split(/[,\s;，；]+/).filter(Boolean),
      require_nda: requireNda,
      allow_download: allowDownload,
      watermark,
      watermark_fields: wmFields,
      watermark_text: wmText.trim() || null,
      notify_on_open: notify,
      enabled,
    };
    if (slug.trim()) input.slug = slug.trim();
    if (password) input.password = password;
    if (editing && clearPassword) input.clear_password = true;
    try {
      if (editing && i) await api.updateLink(i.id, input);
      else await api.createLink(props.docId, input);
      toast(editing ? t("Link settings saved") : t("Link created"));
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const title = editing ? t("Edit link") : props.mode === "clone" ? t("New link from these settings") : t("New link");
  return (
    <Modal labelledBy={`${uid}-t`} class="wide" busy={busy} onClose={props.onClose}>
      <form class="dform" onSubmit={submit} aria-busy={busy}>
        <h2 id={`${uid}-t`}>{title}</h2>
        <p class="muted" style={{ margin: "0 0 16px" }}>{t("One personal link per recipient lets you track each person's reading separately.")}</p>

        <Field label={t("Link name (only visible to you)")} required>
          {(id) => <input id={id} data-autofocus required maxLength={120} placeholder={t("e.g. Acme Ventures – Jane Doe")} value={name} onInput={(e) => setName(e.currentTarget.value)} />}
        </Field>

        <Field label={t("Link address")} hint={editing ? t("The old address stops working immediately once you change this. Send the new address to the recipient again.") : t("Leave empty for a random code, or choose your own, e.g. acme. Letters, numbers, hyphens and underscores only.")}
          error={guessable ? t("A custom address is easy to guess. Keep “Email verification code” on, or set an access password.") : undefined}>
          {(id, d) => (
            <div class="row" style={{ display: "flex", gap: "8px" }}>
              <div class="input-affix" style={{ flex: 1 }}>
                <span class="affix">{location.host}/</span>
                <input id={id} aria-describedby={d} maxLength={40} placeholder={t("Generate randomly")} autocomplete="off" spellcheck={false} value={slug}
                  onInput={(e) => setSlug(e.currentTarget.value.replace(/[^A-Za-z0-9_-]/g, ""))} />
              </div>
              <button type="button" class="btn" title={t("Generate a random address")} onClick={() => setSlug(randomSlug())}><IconRefresh size={15} />{" "}{t("Random")}</button>
            </div>
          )}
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label={t("Document version")}>
            {(id) => (
              <select id={id} value={pinned} onChange={(e) => setPinned(e.currentTarget.value)}>
                <option value="">{t("Always the latest version")}</option>
                {props.versions.map((v) => <option key={v.id} value={v.id}>{t("Pinned to {0}", v.version_label)}</option>)}
              </select>
            )}
          </Field>
          <Field label={t("Expires (optional, in your local time)")}>
            {(id) => <input id={id} type="datetime-local" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />}
          </Field>
        </div>

        <fieldset class="fieldset">
          <legend>{t("Access control")}</legend>
          <Switch label={t("Ask for name and email")} checked={requireEmail} onChange={setRequireEmail} />
          <Switch label={t("Email verification code")} hint={t("Without it you cannot confirm who the person is, and NDA confirmation mails cannot be delivered")} checked={requireOtp} disabled={!requireEmail} onChange={setRequireOtp} />
          <Switch label={t("Reject personal email addresses")} hint={t("Gmail, Outlook and similar; turn it off for recipients who only have a personal address")} checked={blockPersonal} disabled={!requireEmail} onChange={setBlockPersonal} />
          <Switch label={t("Require NDA acceptance")} checked={requireNda} disabled={!requireEmail} onChange={setRequireNda} />
        </fieldset>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label={t("Allowed email domains (optional)")} hint={t("Empty means no limit; separate several with commas")}>
            {(id, d) => <input id={id} aria-describedby={d} disabled={!requireEmail} placeholder="acme.com, partner.org" value={domains} onInput={(e) => setDomains(e.currentTarget.value)} />}
          </Field>
          <Field label={`${t("Access password (optional)")}${editing && i?.has_password ? " " + t("· set") : ""}`} hint={editing && i?.has_password ? t("Leave empty to keep it unchanged") : undefined}>
            {(id) => <input id={id} type="text" autocomplete="off" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />}
          </Field>
        </div>
        {editing && i?.has_password && <Switch label={t("Remove access password")} checked={clearPassword} onChange={setClearPassword} />}
        {!hasPassword && slug.trim() === "" && null}

        <fieldset class="fieldset">
          <legend>{t("Watermark & download")}</legend>
          <Switch label={t("Dynamic watermark")} hint={t("Prints the viewer's details on every page, and on downloaded PDFs too")} checked={watermark} onChange={setWatermark} />
          {watermark && (
            <div style={{ padding: "4px 0 14px" }}>
              <div class="switch-label" id={`${uid}-wm`} style={{ marginBottom: "6px" }}>{t("Watermark contents")}</div>
              <div class="check-grid" role="group" aria-labelledby={`${uid}-wm`}>
                {wmFieldList().map((f) => (
                  <label key={f.id} class="chip-check">
                    <input type="checkbox" checked={wmFields.includes(f.id)} onChange={() => toggleField(f.id)} />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
              <Field label={t("Fixed text (optional)")} hint={t("For example CONFIDENTIAL or an organisation name; it is placed first")}>
                {(id, d) => <input id={id} aria-describedby={d} maxLength={40} value={wmText} onInput={(e) => setWmText(e.currentTarget.value)} />}
              </Field>
              <div class="wm-preview" aria-label={t("Watermark preview")}>{preview}</div>
              <p class="field-hint">{t("The preview uses sample data. The real watermark shows the viewer's own details, with dates in the server time zone.")}</p>
            </div>
          )}
          <Switch label={t("Allow download")} hint={t("Offer a watermarked PDF download (not available inside WeChat)")} checked={allowDownload} onChange={setAllowDownload} />
        </fieldset>

        <fieldset class="fieldset">
          <legend>{t("Notifications")}</legend>
          <Switch label={t("Notify me on open")} hint={t("Email me when someone opens the link, and a reading summary after they finish")} checked={notify} onChange={setNotify} />
          {editing && <Switch label={t("Link enabled")} hint={t("Turning it off disables the link; people already reading lose access on their next page turn")} checked={enabled} onChange={setEnabled} />}
        </fieldset>

        {error && <p class="field-error" role="alert">{error}</p>}
        <div class="dialog-foot">
          <button type="button" class="btn" disabled={busy} onClick={props.onClose}>{t("Cancel")}</button>
          <button class="btn btn-primary" disabled={busy}>{busy ? t("Saving…") : editing ? <><IconCheck size={16} />{" "}{t("Save")}</> : <><IconPlus size={16} />{" "}{t("Create link")}</>}</button>
        </div>
      </form>
    </Modal>
  );
}
