import { useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { logout } from "./authApi.ts";
import { GUEST_AI_CALLS, isGuest } from "./guest.ts";
import { fill, t, type Lang } from "../../shared/i18n.ts";
import "./ProfilePage.css";

type Props = {
  username: string;
  guestLeft?: number | null;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onLoggedOut: () => void;
};

export function ProfilePage({ username, guestLeft, lang, onLangChange, onLoggedOut }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guest = isGuest(username);

  async function signOut() {
    setBusy(true);
    setError("");
    try { await logout(); onLoggedOut(); }
    catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === "AUTH_REQUIRED") onLoggedOut();
      else setError((reason as Error).message);
    } finally { setBusy(false); }
  }

  return <div className="profile-page">
    <header className="profile-intro"><span className="section-kicker">{t("profileKicker")}</span><h1>{t("account")}</h1></header>
    <section className="profile-card" aria-label={t("account")}>
      <div className="profile-card-head"><span>{guest ? t("guestAccount") : t("currentAccount")}</span><strong>{username}</strong></div>
      {guest
        ? <>
            <p>{fill("guestInfo", { left: guestLeft ?? GUEST_AI_CALLS, total: GUEST_AI_CALLS })}</p>
            <p className="profile-message">{t("guestUpsell")}</p>
          </>
        : <p>{t("accountInfo")}</p>}
      <div className="lang-toggle" role="group" aria-label={t("languageLabel")}>
        <span>{t("languageLabel")}</span>
        <div><button type="button" className={lang === "zh" ? "selected" : ""} aria-pressed={lang === "zh"} onClick={() => onLangChange("zh")}>中文</button><button type="button" className={lang === "en" ? "selected" : ""} aria-pressed={lang === "en"} onClick={() => onLangChange("en")}>English</button></div>
      </div>
      {error && <p className="profile-message" role="alert">{error}</p>}
      <button className="button button-outline" onClick={signOut} disabled={busy}>{busy ? t("signingOut") : guest ? t("guestLogout") : t("logout")}</button>
    </section>
  </div>;
}
