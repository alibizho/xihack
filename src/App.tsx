import { useEffect, useState } from "react";
import { localDate, normalizeTask, parseDue, sampleTasks, type Task, type TaskDraft } from "./features/tasks/mockTasks";
import { Icon, type IconName } from "./shared/Icon";
import { TaskComposer } from "./features/tasks/TaskComposer";
import { VoiceAssistant } from "./features/tasks/VoiceAssistant";
import { TodayPage } from "./features/today/TodayPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { TrainingPage } from "./features/training/TrainingPage";
import { AuthPage } from "./features/profile/AuthPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { currentUser } from "./features/profile/authApi";
import { ApiRequestError } from "./shared/api.ts";

type Page = "today" | "tasks" | "training" | "profile";
type Draft = { voice?: boolean; text?: string; edit?: Task };
export type Capture = { id: string; input: string; title: string; time: string; edited: boolean };
const pages: Page[] = ["today", "tasks", "training", "profile"];
const labels: Record<Page, string> = { today: "今天", tasks: "事务", training: "训练", profile: "我的" };
const icons: Record<Page, IconName> = { today: "home", tasks: "list", training: "focus", profile: "user" };
function pageFromHash(): Page {
  const value = location.hash.slice(1);
  return pages.includes(value as Page) ? (value as Page) : "today";
}

export function App() {
  const [username, setUsername] = useState<string | null | undefined>();
  const [connectionError, setConnectionError] = useState("");

  async function checkSession() {
    setUsername(undefined);
    setConnectionError("");
    try { setUsername((await currentUser()).user.username); }
    catch (reason) {
      setUsername(null);
      if (!(reason instanceof ApiRequestError && reason.code === "AUTH_REQUIRED")) setConnectionError((reason as Error).message);
    }
  }

  useEffect(() => { void checkSession(); }, []);

  if (username === undefined) return <div className="auth-page"><p role="status">正在检查登录状态…</p></div>;
  if (username === null) return <AuthPage connectionError={connectionError} onRetry={checkSession} onAuthenticated={(name) => { setConnectionError(""); setUsername(name); }} />;
  return <Workspace key={username} username={username} onLoggedOut={() => setUsername(null)} />;
}

function Workspace({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const taskStorageKey = `xihack-demo-tasks:${username}`;
  const historyStorageKey = `xihack-demo-history:${username}`;
  const [page, setPage] = useState<Page>(pageFromHash);
  const [focusDay, setFocusDay] = useState(localDate(new Date()));
  const [taskViewKey, setTaskViewKey] = useState(0);
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(taskStorageKey) || "null");
      return Array.isArray(saved) ? saved.map(normalizeTask) : sampleTasks;
    } catch {
      return sampleTasks;
    }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Capture[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(taskStorageKey, JSON.stringify(tasks));
  }, [tasks, taskStorageKey]);
  useEffect(() => {
    localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [history, historyStorageKey]);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  function navigate(next: Page, day?: string) {
    if (next === "tasks") setFocusDay(day ?? localDate(new Date()));
    location.hash = next;
    setPage(next);
    window.scrollTo(0, 0);
  }
  function toggle(id: string) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  }
  function updateScore(id: string, axis: "importance" | "urgency", value: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, [axis]: value, [axis === "importance" ? "importanceReason" : "urgencyReason"]: "用户调整" } : task));
  }
  function save(task: TaskDraft, sourceText: string) {
    if (draft?.edit) {
      setTasks((current) => current.map((item) => item.id === draft.edit?.id ? { ...item, ...task } : item));
    } else {
      setTasks((current) => [{ ...task, id: crypto.randomUUID(), done: false }, ...current]);
    }
    setHistory((current) => [{ id: crypto.randomUUID(), input: sourceText || task.title, title: task.title, time: new Date().toISOString(), edited: !!draft?.edit }, ...current].slice(0, 30));
    setDraft(null);
    setTaskViewKey((value) => value + 1);
    navigate("tasks", parseDue(task.due).date);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳到主要内容</a>
      <div className="main-wrap">
        <header className="topbar">
          <a className="app-brand" href="#today" onClick={() => setPage("today")} aria-label="易忆，返回首页">
            <img src="/logo.jpg" alt="" />
            <span>易忆</span>
          </a>
        </header>
        <main id="main" className={`content ${page === "training" ? "training-content" : ""}`}>
          {page === "today" && <TodayPage tasks={tasks} history={history} navigate={navigate} openComposer={(voice, text) => setDraft({ voice, text })} />}
          {page === "tasks" && <TasksPage key={taskViewKey} tasks={tasks} initialDay={focusDay} toggle={toggle} updateScore={updateScore} openComposer={(voice) => setDraft({ voice })} editTask={(task) => setDraft({ edit: task })} />}
          {page === "training" && <TrainingPage tasks={tasks} navigate={() => navigate("tasks")} />}
          {page === "profile" && <ProfilePage username={username} onLoggedOut={onLoggedOut} />}
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          {pages.map((item) => <button key={item} className={page === item ? "active" : ""} onClick={() => navigate(item)} aria-current={page === item ? "page" : undefined}>
            <Icon name={icons[item]} size={20} /><span>{labels[item]}</span>
          </button>)}
        </nav>
      </div>
      {draft?.voice ? <VoiceAssistant username={username} onClose={() => setDraft(null)} onSessionExpired={onLoggedOut} /> : draft && <TaskComposer key={draft.edit?.id || draft.text || "text"} initialText={draft.text} edit={draft.edit} tasks={tasks} history={history} onClose={() => setDraft(null)} onSave={save} />}
    </div>
  );
}
