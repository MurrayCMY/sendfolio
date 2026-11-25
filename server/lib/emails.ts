import { config } from "./config";
import type { Locale } from "./config";
import { escapeHtml, layoutHtml } from "./mail";
import type { MailInput } from "./mail";

type Mail = Omit<MailInput, "to">;

/** Pick the English or Chinese wording. */
const L = (lang: Locale, en: string, zh: string) => (lang === "zh" ? zh : en);

/* ---------- formatting (times use TIMEZONE, "2026-11-24 15:30") ---------- */

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...opts });
const minutes = fmt({});
const seconds = fmt({ second: "2-digit" });
/** "2026-11-24 15:30" in the configured time zone. */
export const fmtTime = (d: string | Date) => minutes.format(new Date(d));
export const fmtTimeSec = (d: string | Date) => seconds.format(new Date(d));
/** "GMT+8" / "GMT" for the configured time zone. */
export const tzLabel = (() => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: config.timezone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? config.timezone;
  } catch { return config.timezone; }
})();

/** 312000 -> "5m 12s" (en) / "5分12秒" (zh) */
export function fmtDuration(ms: number, lang: Locale = config.defaultLocale): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return L(lang, "under 1s", "不到1秒");
  const m = Math.floor(s / 60);
  if (m === 0) return L(lang, `${s}s`, `${s}秒`);
  if (m < 60) return L(lang, `${m}m ${String(s % 60).padStart(2, "0")}s`, `${m}分${String(s % 60).padStart(2, "0")}秒`);
  return L(lang, `${Math.floor(m / 60)}h ${m % 60}m`, `${Math.floor(m / 60)}小时${m % 60}分`);
}

export const deviceName = (d: string | null, wechat: boolean | null, lang: Locale = config.defaultLocale) =>
  `${d === "mobile" ? L(lang, "Phone", "手机") : d === "tablet" ? L(lang, "Tablet", "平板") : L(lang, "Computer", "电脑")}${wechat ? L(lang, " (in WeChat)", "（微信内）") : ""}`;

const codeBlock = (code: string) =>
  `<p style="font-size:28px;letter-spacing:6px;color:${config.brandColor};margin:12px 0;"><strong>${escapeHtml(code)}</strong></p>`;

/** Plain list rows for HTML: label · value, both escaped. */
const rows = (items: [string, string][], colon = ": ") =>
  `<ul style="padding-left:18px;margin:10px 0;">${items.map(([k, v]) => `<li>${escapeHtml(k)}${colon}${escapeHtml(v)}</li>`).join("")}</ul>`;

const link = (url: string, text = url) => `<a href="${escapeHtml(url)}" style="color:${config.brandColor};">${escapeHtml(text)}</a>`;

/* ---------- visitor verification code ---------- */

export function visitorOtpMail(name: string, docTitle: string, code: string, lang: Locale): Mail {
  const app = config.appName;
  const text = L(
    lang,
    `Hi ${name},

Your code to view "${docTitle}" shared via ${app} is:

    ${code}

It expires in 10 minutes. If you didn't request it, you can ignore this email.

${app}`,
    `${name}，您好：

您正在查看通过 ${app} 分享的文件《${docTitle}》。验证码是：

    ${code}

10分钟内有效。如果不是您本人操作，忽略这封邮件即可。

${app}`,
  );
  const n = escapeHtml(name);
  const t = escapeHtml(docTitle);
  const html = layoutHtml(
    L(
      lang,
      `<p>Hi ${n},</p><p>Your code to view "${t}" shared via ${escapeHtml(app)} is:</p>${codeBlock(code)}<p>It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`,
      `<p>${n}，您好：</p><p>您正在查看通过 ${escapeHtml(app)} 分享的文件《${t}》。验证码是：</p>${codeBlock(code)}<p>10分钟内有效。如果不是您本人操作，忽略这封邮件即可。</p>`,
    ),
  );
  return { subject: L(lang, `${code} is your access code · ${app}`, `${code} 是您的访问验证码 · ${app}`), text, html };
}

/* ---------- admin login code ---------- */

export function adminOtpMail(code: string): Mail {
  const lang = config.defaultLocale;
  return {
    subject: L(lang, `Admin sign-in code ${code}`, `后台登录验证码 ${code}`),
    text: L(
      lang,
      `Admin sign-in code: ${code}\n\nIt expires in 10 minutes. If this wasn't you, someone is trying to sign in to your admin area.`,
      `后台登录验证码：${code}\n\n10分钟内有效。如果不是你本人操作，说明有人在尝试登录后台，请留意。`,
    ),
    html: layoutHtml(
      L(
        lang,
        `<p>Admin sign-in code:</p>${codeBlock(code)}<p>It expires in 10 minutes. If this wasn't you, someone is trying to sign in to your admin area.</p>`,
        `<p>后台登录验证码：</p>${codeBlock(code)}<p>10分钟内有效。如果不是你本人操作，说明有人在尝试登录后台，请留意。</p>`,
      ),
    ),
  };
}

/* ---------- NDA confirmation (to the visitor, optional BCC to the admin) ---------- */

export interface NdaConfirmParams {
  name: string;
  email: string;
  nda_label: string;
  doc_title: string;
  record_id: string;
  accepted_at: Date | string;
  lang: Locale;
}

export function ndaConfirmMail(p: NdaConfirmParams): Mail {
  const lang = p.lang;
  const at = `${fmtTime(p.accepted_at)} (${tzLabel})`;
  const org = config.companyName;
  const text = L(
    lang,
    `Hi ${p.name},

Thank you for your interest in ${org}.

You accepted our Non-Disclosure Agreement online on ${at}. The full agreement and the signing record are attached for your records.

Signing record
· Name: ${p.name}
· Email: ${p.email}
· NDA version: ${p.nda_label}
· Document: ${p.doc_title}
· Record ID: ${p.record_id}

If you have any questions, just reply to this email.

${org}`,
    `${p.name}，您好：

感谢您关注 ${org}。

您已于 ${at} 在线同意我们的保密协议。协议全文和签署记录见附件，请留存。

签署记录
· 姓名：${p.name}
· 邮箱：${p.email}
· 协议版本：${p.nda_label}
· 查看文件：《${p.doc_title}》
· 记录编号：${p.record_id}

阅读中有任何问题，直接回复这封邮件就行。

${org}`,
  );
  const n = escapeHtml(p.name);
  const html = layoutHtml(
    L(
      lang,
      `<p>Hi ${n},</p>
<p>Thank you for your interest in ${escapeHtml(org)}.</p>
<p>You accepted our Non-Disclosure Agreement online on ${escapeHtml(at)}. The full agreement and the signing record are attached for your records.</p>
<p style="margin-bottom:0;"><strong>Signing record</strong></p>
${rows([["Name", p.name], ["Email", p.email], ["NDA version", p.nda_label], ["Document", p.doc_title], ["Record ID", p.record_id]])}
<p>If you have any questions, just reply to this email.</p>
<p>${escapeHtml(org)}</p>`,
      `<p>${n}，您好：</p>
<p>感谢您关注 ${escapeHtml(org)}。</p>
<p>您已于 ${escapeHtml(at)} 在线同意我们的保密协议。协议全文和签署记录见附件，请留存。</p>
<p style="margin-bottom:0;"><strong>签署记录</strong></p>
${rows([["姓名", p.name], ["邮箱", p.email], ["协议版本", p.nda_label], ["查看文件", `《${p.doc_title}》`], ["记录编号", p.record_id]], "：")}
<p>阅读中有任何问题，直接回复这封邮件就行。</p>
<p>${escapeHtml(org)}</p>`,
    ),
  );
  return { subject: L(lang, `NDA confirmation · ${org}`, `保密协议签署确认 · ${org}`), text, html };
}

/* ---------- open alert (to the admin) ---------- */

export interface OpenAlertParams {
  name: string;
  email: string;
  doc_title: string;
  version_label: string;
  link_name: string;
  started_at: Date | string;
  geo: string;
  device: string;
  visit_no: number;
  admin_url: string;
}

export function openAlertMail(p: OpenAlertParams): Mail {
  const lang = config.defaultLocale;
  const when = `${fmtTime(p.started_at)} (${tzLabel})`;
  const text = L(
    lang,
    `${p.name} (${p.email}) just opened "${p.doc_title}" ${p.version_label}.

· Link: ${p.link_name}
· Time: ${when}
· Location: ${p.geo}
· Device: ${p.device}
· Visit #${p.visit_no} by this person

Details: ${p.admin_url}`,
    `${p.name}（${p.email}）刚刚打开了《${p.doc_title}》${p.version_label}。

· 链接：${p.link_name}
· 时间：${when}
· 地点：${p.geo}
· 设备：${p.device}
· 这是 TA 第 ${p.visit_no} 次查看这份文件

查看详情：${p.admin_url}`,
  );
  const html = layoutHtml(
    L(
      lang,
      `<p>${escapeHtml(p.name)} (${escapeHtml(p.email)}) just opened "${escapeHtml(p.doc_title)}" ${escapeHtml(p.version_label)}.</p>
${rows([["Link", p.link_name], ["Time", when], ["Location", p.geo], ["Device", p.device], ["Visits", `#${p.visit_no} by this person`]])}
<p>Details: ${link(p.admin_url)}</p>`,
      `<p>${escapeHtml(p.name)}（${escapeHtml(p.email)}）刚刚打开了《${escapeHtml(p.doc_title)}》${escapeHtml(p.version_label)}。</p>
${rows([["链接", p.link_name], ["时间", when], ["地点", p.geo], ["设备", p.device], ["次数", `这是 TA 第 ${p.visit_no} 次查看这份文件`]], "：")}
<p>查看详情：${link(p.admin_url)}</p>`,
    ),
  );
  return { subject: L(lang, `${p.name} opened "${p.doc_title}" · ${p.link_name}`, `${p.name} 打开了《${p.doc_title}》· ${p.link_name}`), text, html };
}

/* ---------- reading summary (to the admin) ---------- */

export interface SummaryParams {
  name: string;
  email: string;
  doc_title: string;
  link_name: string;
  started_at: Date | string;
  duration_ms: number;
  pages_viewed: number;
  max_page: number;
  page_count: number;
  visit_no: number;
  total_duration_ms: number;
  top_pages: { page: number; seconds: number }[];
  admin_url: string;
}

export function summaryMail(p: SummaryParams): Mail {
  const lang = config.defaultLocale;
  const dur = fmtDuration(p.duration_ms, lang);
  const total = fmtDuration(p.total_duration_ms, lang);
  const start = `${fmtTime(p.started_at)} (${tzLabel})`;
  const pageLine = (t: { page: number; seconds: number }) => L(lang, `Page ${t.page} · ${t.seconds}s`, `第 ${t.page} 页 · ${t.seconds}秒`);
  const none = L(lang, "(no page had meaningful reading time)", "（没有有效停留记录）");
  const top = p.top_pages.map((t) => `  ${pageLine(t)}`).join("\n");
  const range = L(
    lang,
    `Viewed ${p.pages_viewed} pages, furthest page ${p.max_page} of ${p.page_count}`,
    `看过 ${p.pages_viewed} 页，最远到第 ${p.max_page} 页（共 ${p.page_count} 页）`,
  );
  const nth = L(lang, `Visit #${p.visit_no}, ${total} in total`, `第 ${p.visit_no} 次查看，累计 ${total}`);
  const topTitle = L(lang, `Most time spent on (${p.top_pages.length} pages)`, `停留最久的${p.top_pages.length}页`);
  const text = L(
    lang,
    `${p.name} (${p.email}) · ${p.link_name}

· Started: ${start}
· Active reading: ${dur}
· ${range}
· ${nth}

${topTitle}
${top || `  ${none}`}

Details: ${p.admin_url}`,
    `${p.name}（${p.email}）· ${p.link_name}

· 开始：${start}
· 有效阅读：${dur}
· ${range}
· ${nth}

${topTitle}
${top || `  ${none}`}

查看详情：${p.admin_url}`,
  );
  const topHtml = p.top_pages.length
    ? `<ul style="padding-left:18px;margin:10px 0;">${p.top_pages.map((t) => `<li>${escapeHtml(pageLine(t))}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(none)}</p>`;
  const html = layoutHtml(
    `<p>${escapeHtml(p.name)} (${escapeHtml(p.email)}) · ${escapeHtml(p.link_name)}</p>
${rows(
  [
    [L(lang, "Started", "开始"), start],
    [L(lang, "Active reading", "有效阅读"), dur],
    [L(lang, "Range", "阅读范围"), range],
    [L(lang, "Total", "累计"), nth],
  ],
  L(lang, ": ", "："),
)}
<p style="margin-bottom:0;"><strong>${escapeHtml(topTitle)}</strong></p>${topHtml}
<p>${L(lang, "Details", "查看详情")}${L(lang, ": ", "：")}${link(p.admin_url)}</p>`,
  );
  return {
    subject: L(
      lang,
      `${p.name} read "${p.doc_title}" for ${dur}, reached page ${p.max_page}/${p.page_count}`,
      `${p.name} 看了《${p.doc_title}》${dur}，读到第 ${p.max_page}/${p.page_count} 页`,
    ),
    text,
    html,
  };
}

/* ---------- delivery test ---------- */

export function deliveryTestMail(): Mail {
  const app = config.appName;
  const en = `This is a delivery test from ${app}. If it landed in your inbox rather than spam, sending is set up correctly.`;
  const zh = `这是一封来自 ${app} 的送达测试邮件。如果您在收件箱（而不是垃圾箱）看到它，说明发信配置正常。`;
  const stamp = new Date().toISOString();
  return {
    subject: `Delivery test · 邮件送达测试 · ${app}`,
    text: `${en}\n\n${zh}\n\nSent at: ${stamp}`,
    html: layoutHtml(`<p>${escapeHtml(en)}</p><p>${escapeHtml(zh)}</p><p style="color:#848F8A;font-size:12px;">${stamp}</p>`),
  };
}
