import { useEffect, useState } from "react";
import { localDate, type Task, type TaskDraft } from "./features/tasks/mockTasks";
import { Icon, type IconName } from "./shared/Icon";
import { TaskComposer } from "./features/tasks/TaskComposer";
import { TodayPage } from "./features/today/TodayPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { TrainingPage } from "./features/training/TrainingPage";
import { AuthPage } from "./features/profile/AuthPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { currentUser } from "./features/profile/authApi";
import { guestCallsLeft, isGuest, spendGuestCall } from "./features/profile/guest";
import { ApiRequestError } from "./shared/api.ts";
import { csrf, listTasks, proposeComplete, proposeCreate, proposeUpdate, type Proposal, type ServerTask } from "./features/tasks/agentApi";
import { displayTask, taskInput } from "./features/tasks/serverTasks";
import { TaskProposalDialog } from "./features/tasks/TaskProposalDialog";
import { TaskReportDialog } from "./features/tasks/TaskReportDialog";

type Page = "today" | "tasks" | "training" | "profile";
type Draft = { edit?: Task };
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
  const historyStorageKey = `xihack-demo-history:${username}`;
  const [page, setPage] = useState<Page>(pageFromHash);
  const [focusDay, setFocusDay] = useState(localDate(new Date()));
  const [taskViewKey, setTaskViewKey] = useState(0);
  const [serverTasks, setServerTasks] = useState<ServerTask[]>([]);
  const [taskError, setTaskError] = useState("");
  const [pendingProposal, setPendingProposal] = useState<Proposal | null>(null);
  const [reportTask, setReportTask] = useState<{ id: string; title: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const guest = isGuest(username);
  const [guestLeft, setGuestLeft] = useState(() => guest ? guestCallsLeft(username) : null);
  function spendCall(): boolean {
    // ponytail: non-guests skip the quota entirely; server-side limits stay authoritative.
    if (!guest) return true;
    const ok = spendGuestCall(username);
    setGuestLeft(guestCallsLeft(username));
    return ok;
  }
  const [history] = useState<Capture[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  const visibleTasks = serverTasks.map(displayTask);
  const openReport = (id: string) => setReportTask({ id, title: serverTasks.find((task) => task.task_id === id)?.title || "已完成事务" });
  async function refreshTasks() {
    try { setServerTasks(await listTasks()); setTaskError(""); setTaskViewKey((value) => value + 1); }
    catch (reason) { setTaskError((reason as Error).message); }
  }

  useEffect(() => { void refreshTasks(); }, []);

  useEffect(() => {
    const onHashChange = () => { const next = pageFromHash(); setPage(next); if (next !== "today") setVoiceOpen(false); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  function navigate(next: Page, day?: string) {
    if (next === "tasks") setFocusDay(day ?? localDate(new Date()));
    setVoiceOpen(false);
    location.hash = next;
    setPage(next);
    window.scrollTo(0, 0);
  }
  function openVoice() { setVoiceText(""); navigate("today"); setVoiceOpen(true); }
  function openTextChat(text: string) { setVoiceText(text); navigate("today"); setVoiceOpen(true); }
  function toggle(id: string) {
    const task = serverTasks.find((item) => item.task_id === id);
    if (!task || task.status === "completed") return;
    void csrf().then((token) => proposeComplete(task, token)).then(setPendingProposal).catch((reason) => setTaskError((reason as Error).message));
  }
  function updateScore(id: string, axis: "importance" | "urgency", value: number) {
    const task = serverTasks.find((item) => item.task_id === id);
    if (!task) return;
    void csrf().then((token) => proposeUpdate(task, { [axis]: value }, token)).then(setPendingProposal).catch((reason) => setTaskError((reason as Error).message));
  }
  async function save(task: TaskDraft) {
    const current = draft?.edit && serverTasks.find((item) => item.task_id === draft.edit?.id);
    const input = taskInput(task);
    const { description: _description, ...changes } = input;
    const proposal = current ? await proposeUpdate(current, changes, await csrf()) : await proposeCreate(input, await csrf());
    setDraft(null);
    setPendingProposal(proposal);
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
          {taskError && <p className="field-error" role="alert">{taskError}</p>}
          {page === "today" && <TodayPage tasks={visibleTasks} history={history} navigate={navigate} voiceOpen={voiceOpen} voiceText={voiceText} openVoice={openVoice} openTextChat={openTextChat} closeVoice={() => setVoiceOpen(false)} onSessionExpired={onLoggedOut} onTasksChanged={() => void refreshTasks()} onTaskCompleted={openReport} guestQuota={guest ? { left: guestLeft ?? 0, spend: spendCall } : undefined} />}
          {page === "tasks" && <TasksPage key={taskViewKey} serverMode tasks={visibleTasks} initialDay={focusDay} toggle={toggle} updateScore={updateScore} openComposer={(voice) => voice ? openVoice() : setDraft({})} editTask={(task) => setDraft({ edit: task })} openReport={(task) => openReport(task.id)} />}
          {page === "training" && <TrainingPage tasks={visibleTasks} navigate={() => navigate("tasks")} />}
          {page === "profile" && <ProfilePage username={username} guestLeft={guestLeft} onLoggedOut={onLoggedOut} />}
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          {pages.map((item) => <button key={item} className={page === item ? "active" : ""} onClick={() => navigate(item)} aria-current={page === item ? "page" : undefined}>
            <Icon name={icons[item]} size={20} /><span>{labels[item]}</span>
          </button>)}
        </nav>
      </div>
      {draft && <TaskComposer key={draft.edit?.id || "new"} edit={draft.edit} onClose={() => setDraft(null)} onSave={save} />}
      {pendingProposal && <TaskProposalDialog proposal={pendingProposal} taskTitle={serverTasks.find((task) => task.task_id === pendingProposal.task_id)?.title} onClose={() => setPendingProposal(null)} onConfirmed={() => void refreshTasks()} onCompleted={(id, title) => setReportTask({ id, title })} />}
      {reportTask && <TaskReportDialog taskId={reportTask.id} title={reportTask.title} onClose={() => setReportTask(null)} />}
    </div>
  );
}
