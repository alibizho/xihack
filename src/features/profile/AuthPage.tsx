import { useState } from "react";
import { login, register } from "./authApi.ts";
import { GUEST_AI_CALLS, registerGuest } from "./guest.ts";
import { fill, t } from "../../shared/i18n.ts";
import "./ProfilePage.css";

type Props = {
  onAuthenticated: (username: string) => void;
  connectionError: string;
  onRetry: () => void;
};

export function AuthPage({ onAuthenticated, connectionError, onRetry }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState("");

  async function enterAsGuest() {
    setGuestBusy(true);
    setError("");
    try { onAuthenticated(await registerGuest()); }
    catch (reason) { setError((reason as Error).message); }
    finally { setGuestBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "register" && password !== confirmPassword) { setError(t("passwordMismatch")); return; }
    if (mode === "register" && !adult) { setError(t("adultRequired")); return; }
    setBusy(true);
    setError("");
    try {
      const result = await (mode === "register" ? register(username, password) : login(username, password));
      setPassword("");
      setConfirmPassword("");
      onAuthenticated(result.user.username);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="auth-page">
    <div className="auth-brand"><img src="/logo.jpg" alt="" /><strong>易忆</strong></div>
    <main className="auth-card" aria-labelledby="auth-title">
      <span className="section-kicker">{t("authKicker")}</span>
      <h1 id="auth-title">{mode === "login" ? t("welcomeBack") : t("createAccount")}</h1>
      <p>{t("authIntro")}</p>
      {connectionError && <div className="auth-error" role="alert">{connectionError}<button type="button" onClick={onRetry}>{t("retryConnection")}</button></div>}
      <form onSubmit={submit}>
        <label htmlFor="auth-username">{t("usernameLabel")}</label>
        <input id="auth-username" value={username} onChange={(event) => setUsername(event.target.value)} pattern="[A-Za-z0-9_]{3,32}" title={t("usernameHint")} minLength={3} maxLength={32} required autoComplete="username" placeholder={t("usernamePlaceholder")} />
        <label htmlFor="auth-password">{t("passwordLabel")}</label>
        <input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={15} maxLength={128} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={t("passwordPlaceholder")} />
        {mode === "register" && <>
          <label htmlFor="auth-confirm">{t("confirmLabel")}</label>
          <input id="auth-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={15} maxLength={128} required autoComplete="new-password" />
          <label className="auth-consent"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} required />{t("adultConsent")}</label>
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? t("pleaseWait") : mode === "login" ? t("loginButton") : t("signUpButton")}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
        {mode === "login" ? t("toRegister") : t("toLogin")}
      </button>
      <button className="auth-guest" type="button" onClick={enterAsGuest} disabled={busy || guestBusy}>
        {guestBusy ? t("guestCreating") : t("guestEnter")}
      </button>
      <p className="auth-guest-note">{fill("guestNote", { n: GUEST_AI_CALLS })}</p>
    </main>
  </div>;
}
