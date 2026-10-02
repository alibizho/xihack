import { useEffect, useState } from "react";
import { deleteProfile, getProfile, updateProfile, type UserProfile } from "./mockProfileApi";
import "./ProfilePage.css";

export function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null | undefined>();
  const [username, setUsername] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getProfile().then((user) => {
      if (active) { setProfile(user); setUsername(user?.username ?? ""); }
    }).catch(() => { if (active) setMessage("资料加载失败，请刷新重试"); });
    return () => { active = false; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await updateProfile(username);
      setProfile(saved);
      setUsername(saved.username);
      setMessage("用户名已保存");
    } catch (error) {
      setMessage((error as Error).message);
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteProfile();
      setProfile(null);
      setUsername("");
      setConfirmDelete(false);
      setMessage("演示资料已删除");
    } catch {
      setMessage("删除失败，请重试");
    } finally { setBusy(false); }
  }

  return <div className="profile-page">
    <header className="profile-intro"><span className="section-kicker">我的 / 设置</span><h1>个人资料</h1></header>
    <section className="profile-card" aria-label="个人资料设置">
      <div className="profile-card-head"><span>演示资料</span><strong>{profile?.username || "未设置用户名"}</strong></div>
      <form onSubmit={save}>
        <label htmlFor="profile-username">用户名</label>
        <input id="profile-username" value={username} onChange={(event) => { setUsername(event.target.value); setMessage(""); }} maxLength={40} autoComplete="nickname" disabled={busy} placeholder="输入用户名" />
        <button className="button button-primary" disabled={busy || !username.trim()}>{profile ? "保存用户名" : "创建演示资料"}</button>
      </form>
      {message && <p className="profile-message" role="status">{message}</p>}
      {profile && <div className="profile-delete">
        <button className="profile-delete-trigger" onClick={() => setConfirmDelete(true)} disabled={busy || confirmDelete}>删除演示资料</button>
        {confirmDelete && <div className="profile-confirm"><p>删除此浏览器保存的用户名？事务和训练记录会保留。</p><div><button className="button button-outline" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button><button className="button profile-delete-button" onClick={remove} disabled={busy}>确认删除</button></div></div>}
      </div>}
    </section>
  </div>;
}
