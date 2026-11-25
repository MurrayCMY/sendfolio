import { LANGS, useLang } from "../i18n";

/** Two-button language switch (EN | 中文) used in the admin sidebar and on the sign-in page. */
export function LangSwitch() {
  const [lang, setLang] = useLang();
  return (
    <div class="langswitch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.code} type="button" class={lang === l.code ? "on" : ""} aria-pressed={lang === l.code} lang={l.code === "zh" ? "zh" : "en"} onClick={() => setLang(l.code)}>
          {l.code === "en" ? "EN" : l.label}
        </button>
      ))}
    </div>
  );
}
