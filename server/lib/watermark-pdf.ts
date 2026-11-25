import { degrees, PDFDocument, rgb } from "pdf-lib";
import type { PDFEmbeddedPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { JOST_LATIN_EXT_B64, NOTO_SANS_SC_B64 } from "./font-data";

interface GlyphPath { scale(x: number, y: number): GlyphPath; translate(x: number, y: number): GlyphPath; toSVG(): string }
interface FKFont {
  unitsPerEm: number;
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): { advanceWidth: number; path: GlyphPath };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadFont = (b64: string) => (fontkit as any).create(Buffer.from(b64, "base64")) as FKFont;

/**
 * Text as vector outlines (1000 units per em, y pointing down, baseline at y = 0). Drawing outlines instead of
 * embedding a font into the visitor's PDF supports Chinese names and avoids clashes with the fonts that PDF has.
 */
function textToPath(text: string, fonts: FKFont[]): { d: string; width: number } {
  let x = 0;
  let d = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const font = fonts.find((f) => f.hasGlyphForCodePoint(cp)) ?? fonts[0];
    const use = font.hasGlyphForCodePoint(cp) ? cp : 63; // "?" for characters no font has (emoji, rare hanzi)
    const g = font.glyphForCodePoint(use);
    const k = 1000 / font.unitsPerEm;
    d += g.path.scale(k, -k).translate(x, 0).toSVG();
    x += g.advanceWidth * k;
  }
  return { d, width: x };
}

/**
 * Stamps a diagonal, repeating, semi-transparent text over every page. The text is drawn once into a small
 * tile that is embedded and placed many times, so the file grows only slightly.
 */
export async function watermarkPdf(original: Uint8Array, rawText: string): Promise<Uint8Array> {
  const text = rawText.slice(0, 160);
  const { d, width } = textToPath(text, [loadFont(NOTO_SANS_SC_B64), loadFont(JOST_LATIN_EXT_B64)]);
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });

  const tiles = new Map<number, { page: PDFEmbeddedPage; w: number; h: number }>();
  const tileFor = async (size: number) => {
    let t = tiles.get(size);
    if (t) return t;
    const s = size / 1000;
    const w = width * s + size * 2;
    const h = size * 1.6;
    const tileDoc = await PDFDocument.create();
    const tp = tileDoc.addPage([w, h]);
    const base = size * 0.45;
    // a light copy offset by one point (shows on dark slides) under a dark one (shows on light slides)
    tp.drawSvgPath(d, { x: size + 1, y: base - 1, scale: s, color: rgb(1, 1, 1), opacity: 0.1, borderWidth: 0 });
    tp.drawSvgPath(d, { x: size, y: base, scale: s, color: rgb(0.2, 0.25, 0.23), opacity: 0.16, borderWidth: 0 });
    t = { page: await pdf.embedPage(tp), w, h };
    tiles.set(size, t);
    return t;
  };

  for (const page of pdf.getPages()) {
    const { width: pw, height: ph } = page.getSize();
    const size = Math.max(14, Math.min(pw, ph) / 38);
    const tile = await tileFor(size);
    const stepX = tile.w + size * 2;
    const stepY = size * 7;
    const reach = Math.hypot(pw, ph);
    let row = 0;
    for (let y = -reach * 0.2; y < reach; y += stepY, row++) {
      const offset = row % 2 ? stepX / 2 : 0;
      for (let x = -reach * 0.2 + offset; x < reach; x += stepX) {
        page.drawPage(tile.page, { x, y, rotate: degrees(30) });
      }
    }
  }
  return pdf.save();
}
