import { useEffect, useState } from "preact/hooks";



/**
 * Burns the watermark into the page pixels. Because the page is a canvas holding image and watermark together,
 * deleting an element in developer tools cannot remove it. It is a deterrent and a way to trace a leak, not a lock:
 * it cannot stop a photo of the screen.
 */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const fs = Math.max(14, w / 46);
  ctx.save();
  ctx.font = `500 ${fs}px Jost, "Noto Sans SC", sans-serif`;
  const tw = ctx.measureText(text).width;
  const stepX = tw + fs * 3;
  const stepY = fs * 6;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const reach = Math.hypot(w, h);
  let row = 0;
  for (let y = -reach / 2; y < reach / 2; y += stepY, row++) {
    const offset = row % 2 ? stepX / 2 : 0;
    for (let x = -reach / 2 - stepX + offset; x < reach / 2; x += stepX) {
      ctx.fillStyle = "rgba(255,255,255,0.10)"; // light edge so it shows on dark slides
      ctx.fillText(text, x + 1, y + 1);
      ctx.fillStyle = "rgba(30,45,40,0.16)"; // dark text for light slides
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A faint tiled overlay. It is a tripwire: the guard below notices if it is removed or hidden. */
export function sentinelBackground(text: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="240"><text x="20" y="130" transform="rotate(-30 230 120)" font-family="Jost,sans-serif" font-size="15" fill="rgba(90,100,95,0.07)">${xml(text)}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/**
 * Every few seconds (and on any DOM change) checks that the watermark layer still exists and is visible.
 * Returns true once it was removed or hidden; the reader then hides the document until the page is reloaded.
 */
export function useWatermarkGuard(enabled: boolean, layerRef: { current: HTMLElement | null }): boolean {
  const [tampered, setTampered] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const el = layerRef.current;
      if (!el || !el.isConnected) return setTampered(true);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility !== "visible" || parseFloat(cs.opacity) < 0.5 || cs.backgroundImage === "none" || r.width < 100 || r.height < 100) {
        setTampered(true);
      }
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    const timer = setInterval(check, 2500);
    const first = setTimeout(check, 1200); // after the first layout
    return () => { mo.disconnect(); clearInterval(timer); clearTimeout(first); };
  }, [enabled]);
  return tampered;
}
