import { useEffect, useState } from "react";
import { sampleTasks, type Task } from "./features/tasks/mockTasks";
import { Icon, type IconName } from "./shared/Icon";
import { TaskComposer } from "./features/tasks/TaskComposer";
import { TodayPage } from "./features/today/TodayPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { TrainingPage } from "./features/training/TrainingPage";

type Page = "today" | "tasks" | "training";
const labels: Record<Page, string> = {
  today: "今日",
  tasks: "事务",
  training: "训练",
};
const icons: Record<Page, IconName> = {
  today: "home",
  tasks: "list",
  training: "focus",
};
const pages: Page[] = ["today", "tasks", "training"];
function pageFromHash(): Page {
  const value = location.hash.slice(1);
  return pages.includes(value as Page) ? (value as Page) : "today";
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("xihack-demo-tasks") || "null") ||
        sampleTasks
      );
    } catch {
      return sampleTasks;
    }
  });
  const [composer, setComposer] = useState<null | "voice" | "text">(null);

  useEffect(() => {
    localStorage.setItem("xihack-demo-tasks", JSON.stringify(tasks));
  }, [tasks]);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  function navigate(next: Page) {
    location.hash = next;
    setPage(next);
  }
  function toggle(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task,
      ),
    );
  }
  function save(task: Omit<Task, "id" | "done">) {
    setTasks((current) => [
      { ...task, id: crypto.randomUUID(), done: false },
      ...current,
    ]);
    setComposer(null);
    navigate("tasks");
  }
  const openComposer = (voice = false) => setComposer(voice ? "voice" : "text");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <span />
          </span>
          <span>
            拾序<span className="brand-dot">.</span>
            <small>把时间留给重要的事</small>
          </span>
        </div>
        <div className="side-caption">工作空间</div>
        <nav className="side-nav" aria-label="主导航">
          {pages.map((item) => (
            <button
              key={item}
              className={`nav-item ${page === item ? "active" : ""}`}
              onClick={() => navigate(item)}
              aria-current={page === item ? "page" : undefined}
            >
              <Icon name={icons[item]} />
              {labels[item]}
              <span className="nav-arrow">›</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="demo-tag">
            <span className="status-dot" />
            前端演示版本
          </div>
          <p>任务保存在当前浏览器。语音与智能解析为预设演示。</p>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">
              <span />
            </span>
            拾序<span className="brand-dot">.</span>
          </div>
          <div className="breadcrumb">
            工作空间 <span>/</span> {labels[page]}
          </div>
          <div className="top-right">
            <span className="top-date">
              {new Intl.DateTimeFormat("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
            <span className="avatar" aria-label="演示用户">
              序
            </span>
          </div>
        </header>
        <main id="main" className="content">
          {page === "today" && (
            <TodayPage
              tasks={tasks}
              toggle={toggle}
              navigate={navigate}
              openComposer={openComposer}
            />
          )}
          {page === "tasks" && (
            <TasksPage
              tasks={tasks}
              toggle={toggle}
              openComposer={openComposer}
            />
          )}
          {page === "training" && <TrainingPage />}
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          {pages.map((item) => (
            <button
              key={item}
              className={page === item ? "active" : ""}
              onClick={() => navigate(item)}
              aria-current={page === item ? "page" : undefined}
            >
              <Icon name={icons[item]} size={21} />
              <span>{labels[item]}</span>
            </button>
          ))}
        </nav>
        {page === "tasks" && (
          <button
            className="mobile-fab"
            onClick={() => openComposer(true)}
            aria-label="新建事务"
          >
            <Icon name="plus" size={26} />
          </button>
        )}
      </div>
      {composer && (
        <TaskComposer
          voice={composer === "voice"}
          onClose={() => setComposer(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
