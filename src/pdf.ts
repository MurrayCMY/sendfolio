import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "./api";
import { t } from "./i18n";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_WIDTH = 2400;
const THUMB_WIDTH = 480;
const CHUNK = 3 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("This browser cannot export WebP")))), "image/webp", quality),
  );

export async function countPages(file: File): Promise<number> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const n = doc.numPages;
  await task.destroy();
  return n;
}

/**
 * Upload the original PDF (chunked), render every page to WebP in this browser
 * (so the server never runs a PDF renderer), upload pages + thumbnails, then finalize.
 */
export async function uploadVersion(
  file: File,
  versionId: string,
  onProgress: (label: string, done: number, total: number) => void,
): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  const parts = Math.ceil(data.byteLength / CHUNK);
  for (let i = 0; i < parts; i++) {
    onProgress(t("Uploading the original file"), i, parts);
    await api.putBinary(`versions/${versionId}/pdf/${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK).buffer, "application/octet-stream");
  }
  await api.completePdf(versionId, parts);

  const task = pdfjs.getDocument({ data: data.slice() });
  const doc = await task.promise;
  try {
    const canvas = document.createElement("canvas");
    const thumb = document.createElement("canvas");
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(t("Rendering and uploading pages"), n - 1, doc.numPages);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;

      thumb.width = THUMB_WIDTH;
      thumb.height = Math.round((canvas.height * THUMB_WIDTH) / canvas.width);
      const tctx = thumb.getContext("2d")!;
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);

      await api.putBinary(`versions/${versionId}/pages/${n}`, await toBlob(canvas, 0.85), "image/webp");
      await api.putBinary(`versions/${versionId}/thumbs/${n}`, await toBlob(thumb, 0.8), "image/webp");
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  onProgress(t("Done"), 1, 1);
  await api.finalize(versionId);
}
