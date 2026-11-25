import { useEffect, useState } from "preact/hooks";
import { call, Info, prefetchOpen } from "./vapi";
import { appConfig, LANGS } from "../i18n";
import { Logo } from "../ui/Logo";
import { Dict, Lang, useLang } from "./i18n";
import { Gate } from "./Gate";
import { NdaStep } from "./NdaStep";
import { Reader } from "./Reader";

export interface Ctx {
  slug: string;
  info: Info;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
  refresh: () => Promise<void>;
  invalidate: () => void;
}

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div class="langtoggle" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.code} class={lang === l.code ? "on" : ""} aria-pressed={lang === l.code} lang={l.code === "zh" ? "zh" : "en"} onClick={() => setLang(l.code)}>
          {l.code === "en" ? "EN" : l.label}
        </button>
      ))}
    </div>
  );
}

export function Brand() {
  return <span class="vbrand"><Logo size={18} /> <b>{appConfig.appName}</b></span>;
}

/** First paint: brand, a skeleton card and a plain-language status, instead of a bare "loading". */
export function Splash({ t, lang, setLang }: { t: Dict; lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div class="vpage" aria-busy="true">
      <header class="vhead"><Brand /><LangToggle lang={lang} setLang={setLang} /></header>
      <main class="vcard narrow" aria-live="polite">
        <div class="skel skel-title" />
        <div class="skel skel-line" />
        <div class="skel skel-line short" />
        <p class="muted center-text">{t.opening}</p>
        <p class="fine center-text">{t.openingHint}</p>
      </main>
    </div>
  );
}

function Invalid({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Dict }) {
  return (
    <div class="vpage">
      <header class="vhead"><Brand /><LangToggle lang={lang} setLang={setLang} /></header>
      <main class="vcard narrow invalid">
        <div class="invalid-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l2.8-2.8a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 11a5 5 0 0 0-7.1 0l-2.8 2.8a5 5 0 0 0 7.1 7.1l1.2-1.2M4 4l16 16" /></svg>
        </div>
        <h1>{t.invalidTitle}</h1>
        <p>{t.invalidBody}</p>
      </main>
    </div>
  );
}

export function Visitor({ slug }: { slug: string }) {
  const [lang, setLang, t] = useLang();
  const [info, setInfo] = useState<Info | null>(null);
  const [invalid, setInvalid] = useState(false);

  const refresh = async () => {
    const r = await call<Info>(slug, "info");
    if (r.data.status === "ok") setInfo(r.data);
    else setInvalid(true);
  };
  useEffect(() => { prefetchOpen(slug); refresh(); }, [slug]);

  useEffect(() => {
    document.title = info?.title ? `${info.title} · ${appConfig.appName}` : appConfig.appName;
  }, [info?.title]);

  // Links that ask for nothing: open a session straight away.
  useEffect(() => {
    if (info?.step === "identity" && !info.require_email && !info.require_password) {
      call(slug, "start", {}).then((r) => (r.ok ? refresh() : setInvalid(true)));
    }
  }, [info?.step]);

  if (invalid) return <Invalid lang={lang} setLang={setLang} t={t} />;
  if (!info) return <Splash t={t} lang={lang} setLang={setLang} />;

  const ctx: Ctx = { slug, info, lang, setLang, t, refresh, invalidate: () => setInvalid(true) };
  if (info.step === "read") return <Reader {...ctx} />;
  if (info.step === "nda") return <NdaStep {...ctx} />;
  if (!info.require_email && !info.require_password) return <Splash t={t} lang={lang} setLang={setLang} />;
  return <Gate {...ctx} />;
}
