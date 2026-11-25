import { useId, useState } from "preact/hooks";
import "../admin/admin.css";
import { api } from "../api";
import { appConfig, t } from "../i18n";
import { LangSwitch } from "../ui/LangSwitch";
import { Logo } from "../ui/Logo";

export function Login({ onDone, notice }: { onDone: () => void; notice?: string }) {
  const uid = useId();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="admin admin-solo admin-login">
      <form
        class="panel login-card"
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (step === "email") {
              await api.requestCode(email);
              setStep("code");
            } else {
              await api.verifyCode(email, code);
              onDone();
            }
          });
        }}
      >
        <div class="login-brand"><span class="mark" aria-hidden="true"><Logo size={20} /></span><span><b>{appConfig.appName}</b></span></div>
        <h1>{t("Admin sign-in")}</h1>
        {notice && step === "email" && <p class="notice" role="status">{notice}</p>}
        {step === "email" ? (
          <>
            <label for={`${uid}-email`} class="login-label">{t("Admin email")}</label>
            <input id={`${uid}-email`} type="email" required autofocus autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          </>
        ) : (
          <>
            <p class="muted">{t("If this is the admin email, a code has been sent. It is valid for 10 minutes.")}</p>
            <label for={`${uid}-code`} class="login-label">{t("6-digit code")}</label>
            <input id={`${uid}-code`} inputMode="numeric" pattern="\d{6}" maxLength={6} required autofocus autocomplete="one-time-code" enterkeyhint="go"
              value={code} onInput={(e) => setCode(e.currentTarget.value)} />
          </>
        )}
        {error && <p class="field-error" role="alert">{error}</p>}
        <button class="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? t("Working…") : step === "email" ? t("Send code") : t("Sign in")}</button>
        {step === "code" && (
          <button type="button" class="btn-link" onClick={() => { setStep("email"); setCode(""); setError(""); }}>{t("Use another email / resend")}</button>
        )}
      </form>
      <div class="login-lang"><LangSwitch /></div>
    </div>
  );
}
