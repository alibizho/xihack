import { useState } from "react";
import { login, register } from "./authApi";
import { GUEST_AI_CALLS, registerGuest } from "./guest";
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
    if (mode === "register" && password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    if (mode === "register" && !adult) { setError("请确认你已年满 18 岁"); return; }
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
      <span className="section-kicker">你的事务助理</span>
      <h1 id="auth-title">{mode === "login" ? "欢迎回来" : "创建账号"}</h1>
      <p>登录后说出要做的事，逐项确认提案后保存到账号。</p>
      {connectionError && <div className="auth-error" role="alert">{connectionError}<button type="button" onClick={onRetry}>重试连接</button></div>}
      <form onSubmit={submit}>
        <label htmlFor="auth-username">用户名</label>
        <input id="auth-username" value={username} onChange={(event) => setUsername(event.target.value)} pattern="[A-Za-z0-9_]{3,32}" title="3 到 32 位英文字母、数字或下划线" minLength={3} maxLength={32} required autoComplete="username" placeholder="3–32 位字母、数字或下划线" />
        <label htmlFor="auth-password">密码</label>
        <input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={15} maxLength={128} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 15 个字符" />
        {mode === "register" && <>
          <label htmlFor="auth-confirm">确认密码</label>
          <input id="auth-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={15} maxLength={128} required autoComplete="new-password" />
          <label className="auth-consent"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} required />我已年满 18 岁</label>
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
        {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
      </button>
      <button className="auth-guest" type="button" onClick={enterAsGuest} disabled={busy || guestBusy}>
        {guestBusy ? "正在创建游客会话…" : "先逛逛 · 游客进入"}
      </button>
      <p className="auth-guest-note">游客可手动添加事务、训练和使用 {GUEST_AI_CALLS} 次 AI 助理</p>
    </main>
  </div>;
}
