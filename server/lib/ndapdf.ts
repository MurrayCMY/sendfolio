import { PDFDocument, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { config } from "./config";
import { JOST_LATIN_EXT_B64, NOTO_SANS_SC_B64 } from "./font-data";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const DARK = rgb(0.102, 0.129, 0.239); // #1A213D
const BODY = rgb(0.247, 0.275, 0.345); // #3F4658
const MUTED = rgb(0.502, 0.529, 0.592); // #80878F

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

interface Fonts {
  main: PDFFont;
  fallback: PDFFont;
  hasMain: (cp: number) => boolean;
  hasFallback: (cp: number) => boolean;
}

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const mainBytes = bytes(NOTO_SANS_SC_B64);
  const fbBytes = bytes(JOST_LATIN_EXT_B64);
  const main = await pdf.embedFont(mainBytes, { subset: true });
  const fallback = await pdf.embedFont(fbBytes, { subset: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (fontkit as any).create as (b: Buffer) => { hasGlyphForCodePoint(cp: number): boolean };
  const mk = create(Buffer.from(mainBytes));
  const fk = create(Buffer.from(fbBytes));
  return {
    main,
    fallback,
    hasMain: (cp) => mk.hasGlyphForCodePoint(cp),
    hasFallback: (cp) => fk.hasGlyphForCodePoint(cp),
  };
}

/** Picks a font per character; characters that no font has (rare hanzi, emoji) become "?" instead of a broken box. */
function pick(ch: string, F: Fonts): { ch: string; font: PDFFont } {
  const cp = ch.codePointAt(0)!;
  if (F.hasMain(cp)) return { ch, font: F.main };
  if (F.hasFallback(cp)) return { ch, font: F.fallback };
  return { ch: "?", font: F.main };
}

const isCjk = (ch: string) => ch.charCodeAt(0) >= 0x2e80;

class Layout {
  page!: PDFPage;
  y = 0;
  private cache = new Map<string, number>();
  constructor(public pdf: PDFDocument, public F: Fonts) {}

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    return this.page;
  }

  private cw(ch: string, size: number): number {
    const key = `${size}:${ch}`;
    let w = this.cache.get(key);
    if (w === undefined) {
      const p = pick(ch, this.F);
      w = p.font.widthOfTextAtSize(p.ch, size);
      this.cache.set(key, w);
    }
    return w;
  }

  width(text: string, size: number): number {
    let w = 0;
    for (const ch of text) w += this.cw(ch, size);
    return w;
  }

  /** Greedy wrap: CJK breaks between characters, Latin between words (very long words break anywhere). */
  wrap(text: string, size: number, maxW: number): string[] {
    const tokens: string[] = [];
    let word = "";
    for (const ch of text) {
      if (isCjk(ch)) {
        if (word) { tokens.push(word); word = ""; }
        tokens.push(ch);
      } else if (ch === " ") {
        word += ch;
        tokens.push(word);
        word = "";
      } else {
        word += ch;
      }
    }
    if (word) tokens.push(word);

    const lines: string[] = [];
    let line = "";
    let lineW = 0;
    const flush = () => { lines.push(line.replace(/\s+$/, "")); line = ""; lineW = 0; };
    for (const tok of tokens) {
      const tw = this.width(tok, size);
      if (lineW + tw <= maxW || !line) {
        if (tw > maxW) {
          for (const ch of tok) {
            const w = this.cw(ch, size);
            if (lineW + w > maxW && line) flush();
            line += ch; lineW += w;
          }
        } else {
          line += tok; lineW += tw;
        }
      } else {
        flush();
        line = tok.replace(/^\s+/, ""); lineW = this.width(line, size);
      }
    }
    if (line) flush();
    return lines;
  }

  drawLine(text: string, x: number, size: number, color = BODY) {
    let cx = x;
    let run = "";
    let runFont: PDFFont | null = null;
    const emit = () => {
      if (run && runFont) {
        this.page.drawText(run, { x: cx, y: this.y, size, font: runFont, color });
        cx += runFont.widthOfTextAtSize(run, size);
      }
      run = "";
    };
    for (const raw of text) {
      const p = pick(raw, this.F);
      if (p.font !== runFont) { emit(); runFont = p.font; }
      run += p.ch;
    }
    emit();
  }

  /** Writes wrapped text, starting a new page when needed. */
  text(text: string, o: { size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number; lead?: number } = {}) {
    const size = o.size ?? 9.5;
    const x = o.x ?? MARGIN;
    const maxW = o.width ?? PAGE_W - MARGIN - x;
    const lead = o.lead ?? size * 1.55;
    for (const line of this.wrap(text, size, maxW)) {
      if (this.y - lead < MARGIN) this.newPage();
      this.y -= lead;
      this.drawLine(line, x, size, o.color);
    }
    this.y -= o.gap ?? 0;
  }
}

const stripBold = (s: string) => s.replace(/\*\*/g, "");

function writeBody(L: Layout, body: string) {
  for (const para of body.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    const isTitle = /^\*\*[^*]+\*\*$/.test(p);
    if (isTitle) L.text(stripBold(p), { size: 15, color: DARK, gap: 10, lead: 22 });
    else L.text(stripBold(p), { gap: 5 });
  }
}

function addFooters(pdf: PDFDocument, F: Fonts, label: string) {
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    const text = `${config.appName} · NDA ${label} · ${i + 1} / ${pages.length}`;
    let w = 0;
    const runs: { t: string; f: PDFFont }[] = [];
    for (const ch of text) {
      const p = pick(ch, F);
      const last = runs[runs.length - 1];
      if (last && last.f === p.font) last.t += p.ch; else runs.push({ t: p.ch, f: p.font });
    }
    for (const r of runs) w += r.f.widthOfTextAtSize(r.t, 8);
    let x = (PAGE_W - w) / 2;
    for (const r of runs) {
      page.drawText(r.t, { x, y: 28, size: 8, font: r.f, color: MUTED });
      x += r.f.widthOfTextAtSize(r.t, 8);
    }
  });
}

export interface NdaForPdf {
  label: string;
  body_zh: string;
  body_en: string;
}

export interface AcceptanceRecord {
  nda_label: string;
  name: string;
  email: string;
  verified: boolean;
  accepted_at: string; // already formatted, with the time zone
  ip: string | null;
  user_agent: string | null;
  doc_title: string;
  nda_sha256: string;
  record_id: string;
}

function writeRecordPage(L: Layout, r: AcceptanceRecord) {
  L.newPage();
  L.text("电子签署记录 · Electronic Acceptance Record", { size: 15, color: DARK, gap: 14, lead: 22 });
  const rows: [string, string][] = [
    ["协议 Agreement", `保密协议 Non-Disclosure Agreement ${r.nda_label}`],
    ["公司 Company", config.companyName],
    ["接收方 Recipient", r.name],
    ["电子邮箱 Email", `${r.email}${r.verified ? "（已通过邮箱验证码验证 verified by one-time code）" : "（未经验证码验证 not verified by one-time code）"}`],
    ["同意时间 Accepted at", r.accepted_at],
    ["IP 地址 IP address", r.ip ?? "—"],
    ["浏览器 User agent", (r.user_agent ?? "—").slice(0, 300)],
    ["查看文件 Document", r.doc_title],
    ["协议文本哈希 SHA-256", r.nda_sha256],
    ["记录编号 Record ID", r.record_id],
  ];
  const labelW = 150;
  for (const [label, value] of rows) {
    const lines = L.wrap(value, 9.5, PAGE_W - MARGIN * 2 - labelW);
    if (L.y - lines.length * 15 < MARGIN) L.newPage();
    L.y -= 15;
    L.drawLine(label, MARGIN, 9, MUTED);
    lines.forEach((line, i) => {
      if (i > 0) L.y -= 15;
      L.drawLine(line, MARGIN + labelW, 9.5, DARK);
    });
    L.y -= 6;
  }
  L.y -= 10;
  L.text("接收方已在平台上勾选“我已阅读并同意上述保密协议，并同意以电子方式签署”并点击同意。", { gap: 4 });
  L.text('Recipient checked "I have read and agree to the NDA above and consent to sign electronically" and clicked to accept on the Platform.');
}

/**
 * The bilingual agreement (Chinese, then English), plus the electronic acceptance record page when `record` is given.
 * Always built as one document: appending a page to a loaded PDF re-embeds the font and produced broken glyphs.
 * Building takes well under a second, so there is nothing to gain from caching a base file.
 */
export async function buildNdaPdf(nda: NdaForPdf, record?: AcceptanceRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Non-Disclosure Agreement ${nda.label}`);
  pdf.setAuthor(config.appName);
  const F = await loadFonts(pdf);
  const L = new Layout(pdf, F);
  L.newPage();
  writeBody(L, nda.body_zh);
  L.newPage();
  writeBody(L, nda.body_en);
  if (record) writeRecordPage(L, record);
  addFooters(pdf, F, nda.label);
  return pdf.save();
}
