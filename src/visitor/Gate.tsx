import { useEffect, useId, useState } from "preact/hooks";
import { call } from "./vapi";
import { errorText } from "./i18n";
import { Brand, Ctx, LangToggle } from "./Visitor";

export function Gate(ctx: Ctx) {
  const { slug, info, t, lang, setLang } = ctx;
  const uid = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function start(e?: Event) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    const r = await call<{ step?: string; pending?: string }>(slug, "start", { name, email, password });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "wait") setCooldown(60);
      return setError(errorText(t, r.data.code));
    }
    if (r.data.step === "code" && r.data.pending) {
      setPending(r.data.pending);
      setCode("");
      setCooldown(60);
    } else {
      await ctx.refresh(); // session cookie is set: continue to NDA or reading
    }
  }

  async function verify(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await call(slug, "verify", { pending, code });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "expired") setPending("");
      return setError(errorText(t, r.data.code));
    }
    await ctx.refresh();
  }

  const askIdentity = info.require_email;
  const willEmail = info.require_otp;
  const errId = `${uid}-err`;
  return (
    <div class="vpage">
      <header class="vhead"><Brand /><LangToggle lang={lang} setLang={setLang} /></header>
      <main class="vcard narrow">
        <h1>{t.title}</h1>
        {!pending ? (
          <form onSubmit={start} aria-busy={busy}>
            <p class="muted">{askIdentity && willEmail ? t.intro(info.title ?? "") : t.introPlain(info.title ?? "")}</p>
            {askIdentity && (
              <>
                <label for={`${uid}-name`}>{t.name}</label>
                <input id={`${uid}-name`} required maxLength={100} autocomplete="name" aria-describedby={error ? errId : undefined}
                  value={name} onInput={(e) => setName(e.currentTarget.value)} />
                <label for={`${uid}-email`}>{t.email}</label>
                <input id={`${uid}-email`} required type="email" inputMode="email" autocomplete="email" aria-describedby={error ? errId : undefined}
                  value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
              </>
            )}
            {info.require_password && (
              <>
                <label for={`${uid}-pw`}>{t.password}</label>
                <input id={`${uid}-pw`} required type="password" autocomplete="off" aria-describedby={error ? errId : undefined}
                  value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
              </>
            )}
            {error && <p id={errId} class="error" role="alert">{error}</p>}
            <button class="primary full" disabled={busy}>{busy ? t.working : willEmail && askIdentity ? t.send : t.view}</button>
            <p class="fine">{t.privacy()}</p>
                      </form>
        ) : (
          <form onSubmit={verify} aria-busy={busy}>
            <p class="muted">{t.codeSent(email)}</p>
            <p class="fine">{t.codeHint}</p>
            <label for={`${uid}-code`}>{t.code}</label>
            <input id={`${uid}-code`} required autofocus inputMode="numeric" autocomplete="one-time-code" pattern="\d{6}" maxLength={6}
              enterkeyhint="go" class="codeinput" aria-describedby={error ? errId : undefined}
              value={code} onInput={(e) => setCode(e.currentTarget.value)} />
            {error && <p id={errId} class="error" role="alert">{error}</p>}
            <button class="primary full" disabled={busy}>{busy ? t.working : t.verify}</button>
            <div class="row between">
              <button type="button" class="link" onClick={() => { setPending(""); setError(""); }}>{t.back}</button>
              <button type="button" class="link" disabled={busy || cooldown > 0} onClick={() => start()}>
                {cooldown > 0 ? t.resendIn(cooldown) : t.resend}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
