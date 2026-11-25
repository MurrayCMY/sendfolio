import { useEffect, useState } from "preact/hooks";
import { Acceptance, api } from "../api";
import { Link } from "../app";
import { fmtRelative, fmtTime } from "../format";
import { IconCheck, IconDownload, IconMail, IconShield } from "../ui/icons";
import { Badge, Card, EmptyState, toast } from "../ui/kit";
import { t } from "../i18n";

/** Every NDA signature with its PDF and confirmation-mail state. Lives under "Visitors" because it is a property of the person. */
export function Acceptances() {
  const [acc, setAcc] = useState<Acceptance[] | null>(null);
  const load = () => api.acceptances().then((r) => setAcc(r.acceptances)).catch(() => setAcc([]));
  useEffect(() => { load(); }, []);

  return (
    <Card title={t("NDA signing records")} icon={<IconShield size={17} />} pad={false}>
      <p class="muted" style={{ margin: "8px 20px 12px" }}>{t("Each signing produces a PDF (the full agreement plus an electronic signing record) that is emailed to the visitor and, if MAIL_BCC is set, to you. Mails that did not go out are retried every 10 minutes, or you can resend them by hand.")}</p>
      {acc === null && <><div class="skel-row" /><div class="skel-row" /></>}
      {acc && acc.length === 0 && (
        <EmptyState icon={<IconShield />} title={t("Nobody has signed the NDA yet")} body={t("Once someone opens a link for the first time and agrees, the signing record and PDF appear here.")} />
      )}
      {acc && acc.length > 0 && (
        <div class="table-wrap"><table class="dtable">
          <thead><tr><th>{t("Signer")}</th><th class="nw">{t("NDA version")}</th><th>{t("Document / link")}</th><th class="nw">{t("Signed on")}</th><th class="nw">{t("Confirmation email")}</th><th><span class="sr">{t("Actions")}</span></th></tr></thead>
          <tbody>
            {acc.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.visitor_id ? <Link href={`/admin/visitors/${a.visitor_id}`}>{a.name_as_entered}</Link> : <b>{a.name_as_entered}</b>}
                  <span class="cell-sub">{a.email}{a.ip ? ` · ${a.ip}` : ""}</span>
                </td>
                <td class="nw">{a.nda_label}</td>
                <td class="clip"><span class="ell">{a.title}</span><span class="cell-sub">{a.link_name ?? t("Deleted link")}</span></td>
                <td class="nw"><span title={fmtTime(a.accepted_at)}>{fmtRelative(a.accepted_at)}</span><span class="cell-sub tnum">{fmtTime(a.accepted_at).slice(5)}</span></td>
                <td class="nw">{a.email_sent_at ? <Badge tone="ok" icon={<IconCheck size={12} />}>{t("Sent")}</Badge> : <Badge tone="warn" icon={<IconMail size={12} />}>{t("Not sent")}</Badge>}</td>
                <td class="actions">
                  <a class="btn btn-sm" href={api.ndaPdfUrl(a.id)} target="_blank" rel="noopener"><IconDownload size={15} /> PDF</a>{" "}
                  <button class="btn btn-sm" onClick={async () => {
                    try { await api.resendNdaEmail(a.id); toast(t("Confirmation email sent")); load(); }
                    catch (err) { toast((err as Error).message, "bad"); }
                  }}><IconMail size={15} /> {a.email_sent_at ? t("Resend") : t("Send")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
