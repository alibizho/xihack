import { useState, type FormEvent } from "react";
import { login, logout, register, type Account } from "../../shared/backendApi";
import "./ProfilePage.css";

type Props = { account: Account | null; onAccountChange: (account: Account | null) => Promise<void>; checking: boolean };

export function AccountPage({ account, onAccountChange, checking }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "register" && !adult) { setMessage("请先确认你已年满 18 岁。"); return; }
    setBusy(true); setMessage("");
    try {
      const next = mode === "login" ? await login(username, password) : await register(username, password);
      setPassword("");
      await onAccountChange(next);
      setMessage("已进入账号事务。浏览器演示任务仍保留在本机。");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setMessage("");
    try { await logout(); await onAccountChange(null); setMessage("已退出账号，当前显示浏览器演示事务。"); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="profile-page">
    <header className="profile-intro"><span className="section-kicker">我的 / 账号</span><h1>个人空间</h1></header>
    <section className="profile-card" aria-label="账号设置">
      <div className="profile-card-head"><span>{checking ? "正在确认登录状态" : account ? "已登录" : "浏览器演示模式"}</span><strong>{account?.username || "你的事务空间"}</strong></div>
      {account ? <div className="account-panel"><p>账号事务保存在服务器。专注训练记录和演示任务仍留在当前浏览器。</p><button type="button" className="button button-outline" onClick={signOut} disabled={busy}>退出登录</button></div> : <>
        <p className="account-note">登录后可跨设备查看账号事务。当前浏览器的演示任务不会自动上传。</p>
        <div className="account-tabs" role="group" aria-label="账号操作"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>登录</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>注册</button></div>
        <form onSubmit={submit}>
          <label htmlFor="account-username">用户名</label><input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_]{3,32}" autoComplete="username" required disabled={busy || checking} placeholder="3–32 位英文字母、数字或下划线" />
          <label htmlFor="account-password">密码</label><input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={15} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} required disabled={busy || checking} placeholder="至少 15 位" />
          {mode === "register" && <label className="adult-check"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} disabled={busy} />我确认已年满 18 岁</label>}
          <button className="button button-primary" disabled={busy || checking}>{busy ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}</button>
        </form>
      </>}
      {message && <p className="profile-message" role="status">{message}</p>}
    </section>
  </div>;
}
