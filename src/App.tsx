import { useEffect, useState } from "react";
import { localDate, normalizeTask, parseDue, sampleTasks, type Task, type TaskDraft } from "./features/tasks/mockTasks";
import { Icon, type IconName } from "./shared/Icon";
import { TaskComposer } from "./features/tasks/TaskComposer";
import { TodayPage } from "./features/today/TodayPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { TrainingPage } from "./features/training/TrainingPage";
import { AccountPage } from "./features/profile/AccountPage";
import { ConfirmTaskProposal } from "./features/tasks/ConfirmTaskProposal";
import { AssistantPage } from "./features/assistant/AssistantPage";
import { toDisplayTask, toTaskInput } from "./features/tasks/backendTasks";
import { getAccount, listAllTasks, proposeComplete, proposeCreate, proposeUpdate, type Account, type BackendTask, type TaskProposal } from "./shared/backendApi";

type Page = "today" | "tasks" | "training" | "assistant" | "profile";
type Draft = { voice?: boolean; text?: string; edit?: Task };
export type Capture = { id: string; input: string; title: string; time: string; edited: boolean };
const pages: Page[] = ["today", "tasks", "training", "assistant", "profile"];
const labels: Record<Page, string> = { today: "今天", tasks: "事务", training: "训练", assistant: "助手", profile: "我的" };
const icons: Record<Page, IconName> = { today: "home", tasks: "list", training: "focus", assistant: "chat", profile: "user" };
function pageFromHash(): Page {
  const value = location.hash.slice(1);
  return pages.includes(value as Page) ? (value as Page) : "today";
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [focusDay, setFocusDay] = useState(localDate(new Date()));
  const [taskViewKey, setTaskViewKey] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(true);
  const [backendTasks, setBackendTasks] = useState<BackendTask[]>([]);
  const [pendingProposal, setPendingProposal] = useState<TaskProposal | null>(null);
  const [accountError, setAccountError] = useState("");
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("xihack-demo-tasks") || "null");
      return Array.isArray(saved) ? saved.map(normalizeTask) : sampleTasks;
    } catch {
      return sampleTasks;
    }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Capture[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("xihack-demo-history") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const visibleTasks = account ? backendTasks.map(toDisplayTask) : tasks;

  async function refreshBackendTasks() {
    const latest = await listAllTasks();
    setBackendTasks(latest);
    setTaskViewKey((value) => value + 1);
  }

  async function changeAccount(next: Account | null) {
    if (next) {
      await refreshBackendTasks();
      setAccount(next);
    } else {
      setAccount(null);
      setBackendTasks([]);
      setTaskViewKey((value) => value + 1);
    }
    setAccountError("");
  }

  useEffect(() => {
    let active = true;
    getAccount().then(async (current) => {
      const latest = await listAllTasks();
      if (active) { setBackendTasks(latest); setAccount(current); }
    }).catch((reason) => {
      if (active && (reason as { status?: number }).status !== 401) setAccountError("账号服务暂时不可用，当前显示浏览器演示事务。");
    }).finally(() => { if (active) setCheckingAccount(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem("xihack-demo-tasks", JSON.stringify(tasks));
  }, [tasks]);
  useEffect(() => {
    localStorage.setItem("xihack-demo-history", JSON.stringify(history));
  }, [history]);
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
    if (account) {
      const current = backendTasks.find((task) => task.task_id === id);
      if (!current || current.status === "completed") return;
      void proposeComplete(current).then(setPendingProposal).catch((reason) => setAccountError((reason as Error).message));
      return;
    }
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  }
  function updateScore(id: string, axis: "importance" | "urgency", value: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, [axis]: value, [axis === "importance" ? "importanceReason" : "urgencyReason"]: "用户调整" } : task));
  }
  async function save(task: TaskDraft, sourceText: string) {
    if (account) {
      const current = draft?.edit && backendTasks.find((item) => item.task_id === draft.edit?.id);
      const input = toTaskInput(task);
      const proposal = current ? await proposeUpdate(current, input) : await proposeCreate(input);
      setDraft(null);
      setPendingProposal(proposal);
      return;
    }
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
          {accountError && <p className="app-error" role="alert">{accountError}</p>}
          {page === "today" && <TodayPage tasks={visibleTasks} history={account ? [] : history} navigate={navigate} openComposer={(voice, text) => setDraft({ voice, text })} />}
          {page === "tasks" && <TasksPage key={taskViewKey} accountMode={!!account} tasks={visibleTasks} initialDay={focusDay} toggle={toggle} updateScore={updateScore} openComposer={(voice) => setDraft({ voice })} editTask={(task) => setDraft({ edit: task })} />}
          {page === "training" && <TrainingPage tasks={visibleTasks} navigate={() => navigate("tasks")} />}
          {page === "assistant" && <AssistantPage signedIn={!!account} openAccount={() => navigate("profile")} onProposal={setPendingProposal} />}
          {page === "profile" && <AccountPage account={account} checking={checkingAccount} onAccountChange={changeAccount} />}
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          {pages.map((item) => <button key={item} className={page === item ? "active" : ""} onClick={() => navigate(item)} aria-current={page === item ? "page" : undefined}>
            <Icon name={icons[item]} size={20} /><span>{labels[item]}</span>
          </button>)}
        </nav>
      </div>
      {draft && <TaskComposer key={draft.edit?.id || draft.text || String(draft.voice)} accountMode={!!account} initialText={draft.text} voice={!!draft.voice} edit={draft.edit} tasks={visibleTasks} history={history} onClose={() => setDraft(null)} onSave={save} />}
      {pendingProposal && <ConfirmTaskProposal proposal={pendingProposal} taskTitle={backendTasks.find((item) => item.task_id === pendingProposal.task_id)?.title} onDone={async () => { try { await refreshBackendTasks(); } catch { setAccountError("事务已写入账号，但清单刷新失败，请重新打开页面。"); } }} onClose={() => setPendingProposal(null)} />}
    </div>
  );
}
