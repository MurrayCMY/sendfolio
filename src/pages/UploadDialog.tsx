import { useEffect, useId, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { IconUpload } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { t } from "../i18n";

/** Create a new document (docId undefined) or add a new version to an existing one. */
export function UploadDialog(props: { docId?: string; onClose: () => void; onDone: (docId: string) => void }) {
  const uid = useId();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [fraction, setFraction] = useState(0);
  const [eta, setEta] = useState("");
  const startedAt = useRef(0);

  // Leaving the page mid-upload loses the work: warn before the tab closes or reloads.
  useEffect(() => {
    if (!busy) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [busy]);

  function report(stage: string, done: number, total: number) {
    // The original file is a small share of the work; rendering and uploading 2 images per page is the rest.
    const frac = stage === t("Done") ? 1 : stage === t("Uploading the original file") ? 0.15 * (done / total) : 0.15 + 0.85 * (done / total);
    setFraction(frac);
    setProgress(stage === t("Done") ? t("Done") : `${stage} ${Math.min(done, total)} / ${total}`);
    const elapsed = (Date.now() - startedAt.current) / 1000;
    if (frac > 0.12 && frac < 1) {
      const left = Math.round((elapsed / frac) * (1 - frac));
      setEta(left > 90 ? t("About {0} min left", Math.ceil(left / 60)) : t("About {0} s left", Math.max(left, 5)));
    } else setEta("");
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    startedAt.current = Date.now();
    try {
      // pdf.js is only loaded here, keeping the rest of the admin small
      const { countPages, uploadVersion } = await import("../pdf");
      setProgress(t("Reading PDF…"));
      const pages = await countPages(file);
      const docId = props.docId ?? (await api.createDocument(title, note)).id;
      const { id: versionId } = await api.createVersion(docId, label, pages);
      await uploadVersion(file, versionId, report);
      props.onDone(docId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy={`${uid}-t`} busy={busy} onClose={props.onClose}>
      <form class="dform" onSubmit={submit} aria-busy={busy}>
        <h2 id={`${uid}-t`}>{props.docId ? t("Upload new version") : t("New document")}</h2>
        {!props.docId && (
          <>
            <label for={`${uid}-title`}>{t("Title")}{" "}<span class="req" aria-hidden="true">*</span></label>
            <input id={`${uid}-title`} required maxLength={200} disabled={busy} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
            <label for={`${uid}-note`}>{t("Internal note (optional)")}</label>
            <textarea id={`${uid}-note`} rows={2} disabled={busy} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </>
        )}
        <label for={`${uid}-ver`}>{t("Version name")}{" "}<span class="req" aria-hidden="true">*</span></label>
        <input id={`${uid}-ver`} required maxLength={60} placeholder={t("e.g. v2")} disabled={busy} value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
        <label for={`${uid}-file`}>{t("PDF file")}{" "}<span class="req" aria-hidden="true">*</span></label>
        <input id={`${uid}-file`} type="file" accept="application/pdf" required disabled={busy} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />

        {busy && (
          <div class="progressbox" role="status">
            <progress value={fraction} max={1} aria-label={t("Upload progress")} />
            <div class="row between small"><span>{progress}</span><span class="muted">{Math.round(fraction * 100)}%{eta && ` · ${eta}`}</span></div>
            <p class="muted small">{t("Keep this page open; closing or reloading interrupts the upload. A 30-page file takes a few minutes.")}</p>
          </div>
        )}
        {error && <p class="field-error" role="alert">{error}</p>}
        <div class="row end">
          <button type="button" class="btn" disabled={busy} onClick={props.onClose}>{t("Cancel")}</button>
          <button class="btn btn-primary" disabled={busy || !file}>{busy ? t("Working…") : <><IconUpload size={16} />{" "}{t("Upload")}</>}</button>
        </div>
      </form>
    </Modal>
  );
}
