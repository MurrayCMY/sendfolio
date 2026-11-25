import { files } from "./storage";
import { db } from "./db";
import { config, pickLocale } from "./config";
import { fmtTimeSec, ndaConfirmMail, tzLabel } from "./emails";
import { sendMail } from "./mail";
import { buildNdaPdf } from "./ndapdf";

const toBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

interface AcceptanceRow {
  id: string;
  accepted_at: string;
  name_as_entered: string;
  email: string;
  ip: string | null;
  user_agent: string | null;
  signed_pdf_blob_key: string | null;
  email_sent_at: string | null;
  nda_id: string;
  label: string;
  body_zh: string;
  body_en: string;
  sha256: string;
  require_otp: boolean;
  title: string;
  lang: string | null;
}

export const recordId = (acceptanceId: string) => `NDA-${acceptanceId.slice(0, 8).toUpperCase()}`;

async function loadAcceptance(id: string): Promise<AcceptanceRow | null> {
  const [row] = await db.sql<AcceptanceRow>`
    select a.id, a.accepted_at, a.name_as_entered, a.email, a.ip, a.user_agent, a.signed_pdf_blob_key, a.email_sent_at, a.lang,
           n.id as nda_id, n.label, n.body_zh, n.body_en, n.sha256,
           coalesce(a.otp_verified, l.require_otp, false) as require_otp, coalesce(a.doc_title, d.title, '') as title
    from nda_acceptances a
    join nda_versions n on n.id = a.nda_version_id
    left join links l on l.id = a.link_id
    left join documents d on d.id = l.document_id
    where a.id = ${id}`;
  return row ?? null;
}

/** Agreement + the electronic acceptance record page for this signing; stored so it can be re-downloaded. */
export async function ensureSignedPdf(acceptanceId: string): Promise<{ pdf: Uint8Array; filename: string; row: AcceptanceRow } | null> {
  const a = await loadAcceptance(acceptanceId);
  if (!a) return null;
  const rid = recordId(a.id);
  const filename = `${config.appName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "NDA"}-NDA-${rid}.pdf`;
  const key = `nda-signed/v2/${a.id}.pdf`; // v2: earlier cached files had broken glyphs on the record page
  const cached = await files().get(key, { type: "arrayBuffer" });
  if (cached) return { pdf: new Uint8Array(cached), filename, row: a };

  const pdf = await buildNdaPdf(
    { label: a.label, body_zh: a.body_zh, body_en: a.body_en },
    {
      nda_label: a.label,
      name: a.name_as_entered,
      email: a.email,
      verified: a.require_otp,
      accepted_at: `${fmtTimeSec(a.accepted_at)} (${tzLabel})`,
      ip: a.ip,
      user_agent: a.user_agent,
      doc_title: a.title,
      nda_sha256: a.sha256,
      record_id: rid,
    },
  );
  await files().set(key, toBuffer(pdf));
  await db.sql`update nda_acceptances set signed_pdf_blob_key = ${key} where id = ${a.id}`;
  return { pdf, filename, row: a };
}

/** Sends the confirmation (with PDF) to the visitor, BCC to MAIL_BCC (if set). Marks the acceptance only after a successful send. */
export async function sendNdaEmail(acceptanceId: string): Promise<boolean> {
  const signed = await ensureSignedPdf(acceptanceId);
  if (!signed) return false;
  const { row: a, pdf, filename } = signed;
  const mail = ndaConfirmMail({
    name: a.name_as_entered,
    email: a.email,
    nda_label: a.label,
    doc_title: a.title,
    record_id: recordId(a.id),
    accepted_at: a.accepted_at,
    lang: pickLocale(a.lang),
  });
  await sendMail({
    to: a.email,
    bcc: process.env.MAIL_BCC || undefined,
    ...mail,
    attachments: [{ filename, content: Buffer.from(pdf), contentType: "application/pdf" }],
  });
  await db.sql`update nda_acceptances set email_sent_at = now() where id = ${a.id}`;
  return true;
}
