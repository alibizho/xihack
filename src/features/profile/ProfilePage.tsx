import { useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { logout } from "./authApi";
import { GUEST_AI_CALLS, isGuest } from "./guest";
import "./ProfilePage.css";

type Props = {
  username: string;
  guestLeft?: number | null;
  onLoggedOut: () => void;
};

export function ProfilePage({ username, guestLeft, onLoggedOut }: Props) {
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
    <header className="profile-intro"><span className="section-kicker">我的 / 设置</span><h1>账号</h1></header>
    <section className="profile-card" aria-label="账号设置">
      <div className="profile-card-head"><span>{guest ? "游客账号" : "当前账号"}</span><strong>{username}</strong></div>
      {guest
        ? <>
            <p>游客模式：AI 助理剩余 {guestLeft ?? GUEST_AI_CALLS} / {GUEST_AI_CALLS} 次；手动添加事务和专注训练不受限制。</p>
            <p className="profile-message">注册正式账号可继续使用 AI 助理并跨设备同步。</p>
          </>
        : <p>事务与助理对话保存在账号中。原先的浏览器演示事务仍留在本机。</p>}
      {error && <p className="profile-message" role="alert">{error}</p>}
      <button className="button button-outline" onClick={signOut} disabled={busy}>{busy ? "正在退出…" : guest ? "退出并注册正式账号" : "退出登录"}</button>
    </section>
  </div>;
}
