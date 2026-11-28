import { useEffect, useRef, useState } from "preact/hooks";
import { call } from "./vapi";
import { errorText } from "./i18n";
import { Brand, Ctx, LangToggle } from "./Visitor";

interface Nda { label: string; body_zh: string; body_en: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Paragraphs split on blank lines; **bold** only. Everything is escaped first. */
function NdaText({ body }: { body: string }) {
  return (
    <>
      {body.split(/\n{2,}/).map((p, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
      ))}
    </>
  );
}

export function NdaStep(ctx: Ctx) {
  const { slug, t, lang, setLang } = ctx;
  const [nda, setNda] = useState<Nda | null>(null);
  const [agree, setAgree] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    call<Nda>(slug, "nda").then((r) => {
      if (r.ok) setNda(r.data);
      else if (r.status === 404) ctx.invalidate();
      else ctx.refresh();
    });
  }, [slug]);

  // The box counts as read once the end is in view (immediately, if the text is short enough not to scroll).
  const checkEnd = () => {
    const el = boxRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 24) setAtEnd(true);
  };
  useEffect(() => { if (nda) setTimeout(checkEnd, 0); }, [nda, lang]);

  async function accept() {
    setBusy(true);
    setError("");
    const r = await call(slug, "accept", { agree: true });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r.data.code));
    await ctx.refresh();
  }

  const jumpToEnd = () => {
    const el = boxRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div class="vpage">
      <header class="vhead"><Brand /><LangToggle lang={lang} setLang={setLang} /></header>
      <main class="vcard">
        <div class="vsteps" aria-hidden="true">
          <span class="vstep done"><span class="vstep-num">✓</span>{t.stepVerify}</span>
          <span class="vstep on"><span class="vstep-num">2</span>{t.stepNda}</span>
          <span class="vstep"><span class="vstep-num">3</span>{t.stepRead}</span>
        </div>
        <h1>{t.ndaTitle}</h1>
        <p class="muted">{t.ndaIntro}</p>
        <div class="ndabox" ref={boxRef} onScroll={checkEnd} lang={lang === "zh" ? "zh-CN" : "en"} tabIndex={0}>
          {nda ? <NdaText body={lang === "zh" ? nda.body_zh : nda.body_en} /> : <p class="muted">{t.loading}</p>}
        </div>
        <div class="row between ndabar">
          <p class={`ndahint ${atEnd ? "done" : ""}`} role="status">{atEnd ? t.ndaScrolled : t.ndaScroll}</p>
          {nda && !atEnd && <button type="button" class="link small" onClick={jumpToEnd}>{t.ndaJumpEnd}</button>}
        </div>
        <label class="agree">
          <input type="checkbox" checked={agree} disabled={!nda || !atEnd} onChange={(e) => setAgree(e.currentTarget.checked)} />
          <span>
            {t.agree}
          </span>
        </label>
        {error && <p class="error" role="alert">{error}</p>}
        <button class="primary full" disabled={!agree || busy} onClick={accept}>{busy ? t.working : t.accept}</button>
      </main>
    </div>
  );
}
