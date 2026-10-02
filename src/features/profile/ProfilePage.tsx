import { useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { logout } from "./authApi";
import "./ProfilePage.css";

export function ProfilePage({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <header className="profile-intro"><span className="section-kicker">我的 / 设置</span><h1>账号</h1></header>
    <section className="profile-card" aria-label="账号设置">
      <div className="profile-card-head"><span>当前账号</span><strong>{username}</strong></div>
      <p>语音助理使用此账号。事务列表目前保存在这个浏览器中，尚未同步到服务器。</p>
      {error && <p className="profile-message" role="alert">{error}</p>}
      <button className="button button-outline" onClick={signOut} disabled={busy}>{busy ? "正在退出…" : "退出登录"}</button>
    </section>
  </div>;
}
