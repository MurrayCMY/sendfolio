import { useEffect, useRef, useState } from "preact/hooks";
import { drawWatermark } from "./watermark";
import { IconRefresh } from "../ui/icons";

// Small in-memory cache so preloaded neighbours show instantly (the responses themselves are no-store).
const cache = new Map<string, Promise<Blob>>();
const MAX_CACHED = 8;

export function fetchPage(url: string): Promise<Blob> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

async function decode(blob: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  if ("createImageBitmap" in window) {
    const bmp = await createImageBitmap(blob);
    return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.src = objectUrl;
  await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(objectUrl) };
}

/**
 * One slide drawn on a canvas, with the watermark (if any) baked into the same pixels.
 * When the URL changes the previous slide stays on screen until the next one is decoded (no blank flash);
 * a spinner appears only if loading takes noticeably long, and a failed load offers a retry.
 */
export function PageCanvas(props: {
  url: string;
  maxWidth: number;
  wm: string | null;
  label: string;
  retryLabel: string;
  onError: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    setState("loading");
    const slowTimer = setTimeout(() => !dead && setSlow(true), 350);
    (async () => {
      try {
        const img = await decode(await fetchPage(props.url));
        const c = ref.current;
        if (dead || !c) return img.done();
        const scale = Math.min(1, props.maxWidth / img.w);
        c.width = Math.round(img.w * scale);
        c.height = Math.round(img.h * scale);
        const g = c.getContext("2d")!;
        g.drawImage(img.src, 0, 0, c.width, c.height);
        img.done();
        if (props.wm) drawWatermark(g, c.width, c.height, props.wm);
        setState("ready");
      } catch {
        if (!dead) { setState("error"); props.onError(); }
      }
    })();
    return () => { dead = true; clearTimeout(slowTimer); setSlow(false); };
  }, [props.url, props.maxWidth, props.wm, attempt]);

  return (
    <div class="pwrap" aria-busy={state === "loading"}>
      <canvas ref={ref} class="pcanvas" width={1600} height={900} role="img" aria-label={props.label} />
      {state === "loading" && slow && <div class="pspin" role="status"><span class="spinner" /></div>}
      {state === "error" && (
        <div class="perr">
          <button class="primary" onClick={() => { cache.delete(props.url); setAttempt((a) => a + 1); }}>
            <IconRefresh /> {props.retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
