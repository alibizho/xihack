import { useState } from "react";
import type { Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import { TaskRow } from "./TaskRow";
import "./TasksPage.css";

const quadrantNames = [
  "重要且紧急",
  "重要不紧急",
  "紧急不重要",
  "不重要不紧急",
];
const quadrant = (task: Task) =>
  task.important ? (task.urgent ? 0 : 1) : task.urgent ? 2 : 3;
type Props = {
  tasks: Task[];
  toggle: (id: string) => void;
  openComposer: (voice?: boolean) => void;
};

export function TasksPage({ tasks, toggle, openComposer }: Props) {
  const [view, setView] = useState<"list" | "matrix">("list");
  const [query, setQuery] = useState("");
  const visible = tasks.filter((task) =>
    task.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="eyebrow">
        <span className="eyebrow-line" /> TASKS, WITH CLARITY
      </div>
      <div className="page-heading task-heading">
        <div>
          <h1>
            事务清单<span className="period">.</span>
          </h1>
          <p>把重要和紧急分开看，安排更有把握。</p>
        </div>
        <button
          className="button button-primary desktop-add"
          onClick={() => openComposer(true)}
        >
          <Icon name="plus" /> 新建事务
        </button>
      </div>
      <div className="task-toolbar">
        <div className="segmented" role="group" aria-label="视图切换">
          <button
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <Icon name="list" size={17} /> 列表
          </button>
          <button
            className={view === "matrix" ? "selected" : ""}
            onClick={() => setView("matrix")}
            aria-pressed={view === "matrix"}
          >
            <Icon name="home" size={17} /> 四象限
          </button>
        </div>
        <label className="search-box">
          <Icon name="search" size={18} />
          <span className="sr-only">搜索事务</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索事务"
          />
        </label>
      </div>
      {view === "list" ? (
        <section className="task-panel" aria-label="事务列表">
          <div className="panel-head">
            <span>全部事务</span>
            <span>{visible.length} 项</span>
          </div>
          {visible.length ? (
            visible.map((task) => (
              <TaskRow key={task.id} task={task} toggle={toggle} />
            ))
          ) : (
            <div className="empty-state">没有找到相关事务。</div>
          )}
        </section>
      ) : (
        <div className="matrix" aria-label="重要度与紧急度四象限">
          {quadrantNames.map((name, index) => (
            <section className={`quadrant q-${index}`} key={name}>
              <div className="quadrant-heading">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{name}</h2>
                <span>
                  {
                    visible.filter(
                      (task) => !task.done && quadrant(task) === index,
                    ).length
                  }
                </span>
              </div>
              <div className="quadrant-body">
                {visible
                  .filter((task) => !task.done && quadrant(task) === index)
                  .map((task) => (
                    <button
                      className="matrix-task"
                      key={task.id}
                      onClick={() => toggle(task.id)}
                      aria-label={`完成${task.title}`}
                    >
                      <span className="tiny-check" />
                      {task.title}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="info-note">
        <Icon name="focus" size={18} />{" "}
        演示数据保存在此浏览器中；正式版将接入语音转写和智能解析。
      </div>
    </>
  );
}
