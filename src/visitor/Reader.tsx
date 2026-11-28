import { useEffect, useRef, useState } from "preact/hooks";
import { call, imageUrl, OpenData, takePrefetchedOpen } from "./vapi";
import { useTracking } from "./tracking";
import { fetchPage, PageCanvas } from "./PageCanvas";
import { sentinelBackground, useWatermarkGuard } from "./watermark";
import { appConfig } from "../i18n";
import { Brand, Ctx, LangToggle } from "./Visitor";
import { IconChevronLeft, IconChevronRight, IconDownload, IconFullscreen, IconFullscreenExit, IconGrid, IconMenu, IconX, IconZoomIn, IconZoomOut } from "../ui/icons";

function useMedia(query: string): boolean {
  const [m, setM] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

const lastKey = (slug: string) => `sendfolio_page_${slug}`;
const readLast = (slug: string): number | null => {
  try { const n = Number(localStorage.getItem(lastKey(slug))); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
};

export function Reader(ctx: Ctx & { docId?: string; onBackToRoom?: () => void }) {
  const { slug, t, lang, setLang, docId, onBackToRoom } = ctx;
  const [data, setData] = useState<OpenData | null>(null);
  const [page, setPage] = useState(1);
  const [showThumbs, setShowThumbs] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [resumeNote, setResumeNote] = useState<number | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [fs, setFs] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canFs = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const wide = useMedia("(min-width: 900px)");
  const listRef = useRef<HTMLDivElement>(null);
  const checking = useRef(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const resumedScroll = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const tampered = useWatermarkGuard(!!data?.watermark, layerRef);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const inWechat = /MicroMessenger/i.test(navigator.userAgent);

  useEffect(() => {
    (async () => {
      const pre = !docId ? takePrefetchedOpen(slug) : undefined;
      let r = pre ? await pre : undefined;
      if (!r || !r.ok) r = await call<OpenData>(slug, "open", docId ? { document_id: docId } : {});
      if (r.ok) {
        setData(r.data);
        const saved = readLast(docId ? `${slug}_${docId}` : slug);
        if (saved && saved > 1 && saved <= r.data.page_count) { setPage(saved); setResumeNote(saved); }
      } else if (r.status === 404) ctx.invalidate();
      else ctx.refresh(); // e.g. NDA still required, or session lost
    })();
  }, [slug, docId]);

  // An image request failing usually means the link was switched off while reading.
  const recheck = async () => {
    if (checking.current) return;
    checking.current = true;
    const r = await call<{ status: string }>(slug, "info");
    if (r.data.status !== "ok") ctx.invalidate();
    setTimeout(() => (checking.current = false), 3000);
  };

  useTracking(slug, data?.preview ? undefined : data?.visit_id, page, ctx.invalidate);

  const count = data?.page_count ?? 0;
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(count, 1));
  // Relative paging from the latest state, so rapid key presses are never dropped.
  const step = (d: number) => setPage((p) => clamp(p + d));
  const goTo = (n: number) => {
    const target = clamp(n);
    setPage(target);
    if (!wide) listRef.current?.children[target - 1]?.scrollIntoView({ block: "start" });
  };

  // Remember the last page (on this device only) and drop zoom when the page changes.
  useEffect(() => {
    if (!data) return;
    try { localStorage.setItem(lastKey(slug), String(page)); } catch { /* private mode */ }
  }, [page, data]);
  useEffect(() => setZoomed(false), [page]);
  useEffect(() => {
    if (resumeNote === null) return;
    const id = setTimeout(() => setResumeNote(null), 8000);
    return () => clearTimeout(id);
  }, [resumeNote]);

  // Desktop: keyboard paging and neighbour preloading (two pages each way).
  useEffect(() => {
    if (!data || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (gridOpen) { if (e.key === "Escape") setGridOpen(false); return; }
      if (e.key === "Escape") { setZoomed(false); setJumpOpen(false); }
      if (e.key === "f" || e.key === "F") toggleFs();
      if (e.key === "g" || e.key === "G") setGridOpen(true);
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") step(1);
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") step(-1);
    };
    window.addEventListener("keydown", onKey);
    for (const d of [-2, -1, 1, 2]) {
      const n = page + d;
      if (n >= 1 && n <= count) fetchPage(imageUrl(slug, "pages", data.visit_id, n)).catch(() => {});
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [data, wide, page, gridOpen]);

  useEffect(() => {
    if (wide) document.querySelector(".rthumbs .on")?.scrollIntoView({ block: "nearest" });
  }, [page, wide]);

  // Mobile: report which page is most visible while scrolling the single column.
  useEffect(() => {
    if (wide || !data || !listRef.current) return;
    const els = Array.from(listRef.current.children);
    if (resumeNote && !resumedScroll.current) {
      resumedScroll.current = true;
      els[resumeNote - 1]?.scrollIntoView({ block: "start" });
    }
    const ratios = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
        let best = 0, max = -1;
        els.forEach((el, i) => {
          const r = ratios.get(el) ?? 0;
          if (r > max) { max = r; best = i; }
        });
        if (max > 0) setPage(best + 1);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [wide, data]);

  // Close the jump panel on an outside click.
  useEffect(() => {
    if (!jumpOpen) return;
    const on = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".jumpwrap")) setJumpOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [jumpOpen]);

  if (!data) {
    return (
      <div class="reader" aria-busy="true">
        <header class="rhead"><Brand /><span class="rtitle" /><LangToggle lang={lang} setLang={setLang} /></header>
        <div class="rbody"><section class="rstage" role="status"><div class="skel skel-slide" /></section></div>
        <footer class="rfoot"><span>{t.opening}</span><span class="muted">{t.openingHint}</span></footer>
      </div>
    );
  }
  if (tampered) {
    return (
      <div class="center">
        <div class="vcard narrow" role="alert">
          <h1>{t.tamperTitle}</h1>
          <p>{t.tamperBody}</p>
          <button class="primary full" onClick={() => location.reload()}>{t.reload}</button>
        </div>
      </div>
    );
  }

  const wm = data.watermark;
  const pages = Array.from({ length: count }, (_, i) => i + 1);
  const img = (kind: "pages" | "thumbs", n: number) => imageUrl(slug, kind, data.visit_id, n, docId ?? data.document_id);
  const block = (e: Event) => e.preventDefault();
  const onTouchStart = (e: TouchEvent) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s || zoomed) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) step(dx < 0 ? 1 : -1);
  };

  return (
    <div class={`reader ${fs ? "fs" : ""}`} ref={rootRef} onContextMenu={block} onDragStart={block}>
      {data.preview && (
        <div class="preview-bar" role="status">
          <span>{t.previewBanner}</span>
          <a href="/admin">{t.exitPreview}</a>
        </div>
      )}
      <header class="rhead">
        {onBackToRoom ? (
          <button type="button" class="rback" onClick={onBackToRoom}>← {t.backToRoom}</button>
        ) : (
          <Brand />
        )}
        <h1 class="rtitle">{data.title}</h1>
        {appConfig.ctaLabel && appConfig.ctaUrl && (
          <a class="rcta" href={appConfig.ctaUrl} target="_blank" rel="noopener noreferrer">{appConfig.ctaLabel}</a>
        )}
        {data.allow_download && !inWechat && (
          <a class="dlbtn" href={`/api/v/${slug}/download/${data.visit_id}`}><IconDownload size={16} /> {t.download}</a>
        )}
        {data.allow_download && inWechat && <span class="dlhint">{t.dlWechat}</span>}
        <LangToggle lang={lang} setLang={setLang} />
      </header>
      <div class="sr" aria-live="polite">{t.pageLabel(page, count)}</div>
      <div class="rprogress" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={page} aria-label={t.pageLabel(page, count)}>
        <span style={{ width: `${(page / Math.max(count, 1)) * 100}%` }} />
      </div>

      {wide ? (
        <div class="rbody">
          {showThumbs && (
            <aside class="rthumbs" aria-label={t.thumbs}>
              {pages.map((n) => (
                <button key={n} class={n === page ? "on" : ""} aria-current={n === page ? "page" : undefined}
                  aria-label={t.pageLabel(n, count)} onClick={() => setPage(n)}>
                  <img src={img("thumbs", n)} alt="" loading="lazy" draggable={false} onError={recheck} />
                  <span>{n}</span>
                </button>
              ))}
            </aside>
          )}
          <section class={`rstage ${zoomed ? "zoomed" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div class="rtools">
              <button class="tool" aria-label={t.thumbs} aria-pressed={showThumbs} onClick={() => setShowThumbs(!showThumbs)}><IconMenu /></button>
              <button class="tool" aria-label={zoomed ? t.zoomOut : t.zoomIn} aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>
                {zoomed ? <IconZoomOut /> : <IconZoomIn />}
              </button>
              <button class="tool" aria-label={t.allPages} onClick={() => setGridOpen(true)}><IconGrid /></button>
              {canFs && (
                <button class="tool" aria-label={fs ? t.exitFullscreen : t.fullscreen} aria-pressed={fs} onClick={toggleFs}>
                  {fs ? <IconFullscreenExit /> : <IconFullscreen />}
                </button>
              )}
            </div>
            <div class="rpage" onClick={() => setZoomed((z) => !z)}>
              <PageCanvas url={img("pages", page)} maxWidth={2400} wm={wm} label={t.pageLabel(page, count)} retryLabel={t.retry} onError={recheck} />
            </div>
            {data.watermark && <div class="wmlayer" ref={layerRef} aria-hidden="true" style={{ backgroundImage: sentinelBackground(wm ?? "") }} />}
            <button class="rnav prev" disabled={page <= 1} onClick={() => step(-1)} aria-label={t.prev}><IconChevronLeft size={28} /></button>
            <button class="rnav next" disabled={page >= count} onClick={() => step(1)} aria-label={t.next}><IconChevronRight size={28} /></button>
          </section>
        </div>
      ) : (
        <div class="rcolumn" ref={listRef}>
          {pages.map((n) => (
            <div class="mpage" key={n}>
              {/* only pages near the one on screen are decoded, so a 30-page deck does not exhaust phone memory */}
              {Math.abs(n - page) <= 2 && (
                <PageCanvas url={img("pages", n)} maxWidth={1280} wm={wm} label={t.pageLabel(n, count)} retryLabel={t.retry} onError={recheck} />
              )}
            </div>
          ))}
          {data.watermark && <div class="wmlayer" ref={layerRef} aria-hidden="true" style={{ backgroundImage: sentinelBackground(wm ?? "") }} />}
        </div>
      )}

      {resumeNote !== null && (
        <div class="toast" role="status">
          <span>{t.resume(resumeNote)}</span>
          <button class="link" onClick={() => { setResumeNote(null); goTo(1); }}>{t.restart}</button>
        </div>
      )}

      {gridOpen && (
        <div class="gridmask" onClick={() => setGridOpen(false)}>
          <div class="gridpanel" role="dialog" aria-modal="true" aria-label={t.allPages} onClick={(e) => e.stopPropagation()}>
            <div class="gridhead">
              <h2>{t.allPages}</h2>
              <button class="tool" aria-label={t.close} autoFocus onClick={() => setGridOpen(false)}><IconX /></button>
            </div>
            <div class="gridbody">
              <p class="gridcount"><span>{t.pagesN(count)}</span></p>
              <div class="gridcells">
                {pages.map((n) => (
                  <button key={n} class={n === page ? "on" : ""} aria-label={t.pageLabel(n, count)} onClick={() => { goTo(n); setGridOpen(false); }}>
                    <span class="gimg"><img src={img("thumbs", n)} alt="" loading="lazy" draggable={false} onError={recheck} /></span>
                    <span class="gnum">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer class="rfoot">
        <span>{t.confidential(data.name)}</span>
        {wide && <span class="hint">{t.keysHint}</span>}
        <span class="jumpwrap">
          <button class="pageno" aria-haspopup="true" aria-expanded={jumpOpen} aria-label={`${t.pageLabel(page, count)}. ${t.jump}`}
            onClick={() => { setJumpOpen(!jumpOpen); setJumpValue(""); }}>
            {page} / {count}
          </button>
          {jumpOpen && (
            <div class="jump" role="group" aria-label={t.jump}>
              <form onSubmit={(e) => { e.preventDefault(); const n = Number(jumpValue); if (n >= 1 && n <= count) { goTo(n); setJumpOpen(false); } }}>
                <input type="number" min={1} max={count} inputMode="numeric" autoFocus placeholder={t.jumpInput} aria-label={t.jumpInput}
                  value={jumpValue} onInput={(e) => setJumpValue(e.currentTarget.value)} />
                <button class="primary small">{t.jumpGo}</button>
              </form>
              <div class="jumpgrid">
                {pages.map((n) => (
                  <button key={n} class={n === page ? "on" : ""} aria-label={t.pageLabel(n, count)} onClick={() => { goTo(n); setJumpOpen(false); }}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </span>
      </footer>
    </div>
  );
}
