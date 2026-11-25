import nodemailer from "nodemailer";
import { config } from "./config";
import type { Transporter } from "nodemailer";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  bcc?: string;
  attachments?: MailAttachment[];
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? "465");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Single entry point for all outgoing mail (any SMTP server: Gmail, Resend, Postmark, SES, your own ...).
 */
export async function sendMail(input: MailInput): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PASS) {
    // No SMTP configured (local try-out): print the message, including login codes, to the server log.
    console.log(`[mail:not-sent] to=${input.to} subject=${input.subject}\n${input.text}`);
    return;
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
    to: input.to,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });
}

/** Single-column, light, no external images; the logo is text. */
export function layoutHtml(bodyHtml: string): string {
  const brand = config.brandColor;
  return `<!doctype html><html><body style="margin:0;background:#F4F5F9;font-family:-apple-system,'PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif;color:#3F4658;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
<div style="font-size:15px;letter-spacing:.04em;color:${brand};margin-bottom:24px;"><strong>${escapeHtml(config.appName)}</strong></div>
<div style="background:#fff;border:1px solid #DDE0EA;border-radius:6px;padding:28px 24px;font-size:15px;line-height:1.7;">${bodyHtml}</div>
</div></body></html>`;
}
