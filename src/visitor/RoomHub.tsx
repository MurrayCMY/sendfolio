import { useEffect, useState } from "preact/hooks";
import { appConfig } from "../i18n";
import { call, RoomData, RoomDoc, roomThumbUrl } from "./vapi";
import { Reader } from "./Reader";
import { Brand, Ctx, LangToggle } from "./Visitor";

export function RoomHub(ctx: Ctx) {
  const { slug, t, lang, setLang } = ctx;
  const [room, setRoom] = useState<RoomData | null>(null);
  const [activeDoc, setActiveDoc] = useState<RoomDoc | null>(null);

  useEffect(() => {
    call<RoomData>(slug, "room").then((r) => {
      if (r.ok) setRoom(r.data);
      else if (r.status === 404) ctx.invalidate();
      else ctx.refresh();
    });
  }, [slug]);

  if (activeDoc) {
    return <Reader {...ctx} docId={activeDoc.id} onBackToRoom={() => setActiveDoc(null)} />;
  }

  // Group documents by section while preserving sort order.
  const groups: { section: string; docs: RoomDoc[] }[] = [];
  for (const d of room?.documents ?? []) {
    const sec = d.section?.trim() || "";
    const existing = groups.find((g) => g.section === sec);
    if (existing) existing.docs.push(d);
    else groups.push({ section: sec, docs: [d] });
  }

  return (
    <div class="vpage room-page">
      {room?.preview && (
        <div class="preview-bar" role="status">
          <span>{t.previewBanner}</span>
          <a href="/admin">{t.exitPreview}</a>
        </div>
      )}
      <header class="vhead">
        <Brand />
        <div class="row" style={{ gap: "12px" }}>
          {appConfig.ctaLabel && appConfig.ctaUrl && (
            <a class="rcta" href={appConfig.ctaUrl} target="_blank" rel="noopener noreferrer">{appConfig.ctaLabel}</a>
          )}
          <LangToggle lang={lang} setLang={setLang} />
        </div>
      </header>
      <main class="room-main">
        <div class="room-hero">
          <span class="room-pill">{t.dataRoom}</span>
          <h1>{room?.title ?? ctx.info.title}</h1>
          {room?.description && <p class="muted">{room.description}</p>}
        </div>
        {!room ? (
          <div class="room-grid">
            {[0, 1, 2].map((i) => <div key={i} class="room-card"><div class="skel" style={{ aspectRatio: "16/9" }} /><div style={{ padding: "14px" }}><div class="skel skel-line" /></div></div>)}
          </div>
        ) : room.documents.length === 0 ? (
          <div class="vcard narrow center-text"><p class="muted">{t.roomEmpty}</p></div>
        ) : (
          groups.map((g) => (
            <section key={g.section || "_default"} class="room-section">
              {g.section && <h2 class="room-sec-title">{g.section}</h2>}
              <div class="room-grid">
                {g.docs.map((d) => (
                  <button key={d.id} type="button" class="room-card" onClick={() => setActiveDoc(d)}>
                    <div class="room-thumb">
                      <img src={roomThumbUrl(slug, d.id)} alt="" loading="lazy" />
                      <span class="room-pages">{t.pagesN(d.page_count)}</span>
                    </div>
                    <div class="room-card-body">
                      <b>{d.title}</b>
                      <span class="muted">{d.version_label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
