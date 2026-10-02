import { useEffect, useState } from "react";
import { formatDue, localDate, parseDue, priorityScore, quadrant, tasksOnDate, type Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import { TaskRow } from "./TaskRow";
import "./TasksPage.css";

const quadrants = [
  { id: 1, title: "重要但不紧急", action: "计划推进" },
  { id: 0, title: "重要且紧急", action: "立即处理" },
  { id: 3, title: "不重要且不紧急", action: "延后或删除" },
  { id: 2, title: "紧急但不重要", action: "快速处理或委派" },
];
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
type Props = {
  tasks: Task[];
  initialDay?: string;
  toggle: (id: string) => void;
  updateScore: (id: string, axis: "importance" | "urgency", value: number) => void;
  openComposer: (voice?: boolean) => void;
  editTask: (task: Task) => void;
};

export function TasksPage({ tasks, initialDay, toggle, updateScore, openComposer, editTask }: Props) {
  const [view, setView] = useState<"cards" | "matrix">("cards");
  const [showDone, setShowDone] = useState(false);
  const [selectedDay, setSelectedDay] = useState(initialDay ?? localDate(new Date()));
  const matching = tasks.filter((task) => task.done === showDone);
  const ordered = tasksOnDate(matching, selectedDay);
  const openCount = tasks.filter((task) => !task.done).length;
  const today = new Date();
  const center = new Date(`${selectedDay || localDate(today)}T00:00:00`);
  const dates = Array.from({ length: 7 }, (_, offset) => { const date = new Date(center); date.setDate(center.getDate() + offset - 3); return date; });

  useEffect(() => { setSelectedDay(initialDay ?? localDate(new Date())); }, [initialDay]);
  function changeWeek(weeks: number) {
    const date = new Date(center);
    date.setDate(date.getDate() + weeks * 7);
    setSelectedDay(localDate(date));
  }

  return <div className="tasks-page">
    <header className="tasks-intro"><div><h1>把事情排好顺序</h1><p>{openCount} 件待办 · 按日期与时间查看</p></div><button className="button button-primary" onClick={() => openComposer(true)} aria-label="打开语音助理"><Icon name="mic" size={18} /> 语音询问</button></header>
    <div className="task-workspace">
      <div className="task-add-row"><strong>事务日程</strong><button className="button button-primary" onClick={() => openComposer(false)}><Icon name="plus" size={17} /> 添加事务</button></div>
      {view === "cards" && <div className="date-picker"><div className="date-picker-head"><strong>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(center)}</strong><div className="date-picker-actions"><button className="week-step" onClick={() => changeWeek(-1)} aria-label="前一周">‹</button><button className="week-step" onClick={() => changeWeek(1)} aria-label="后一周">›</button><button className={selectedDay ? "unscheduled-button" : "unscheduled-button selected"} onClick={() => setSelectedDay("")}>未安排 {matching.filter((task) => !parseDue(task.due).date).length}</button></div></div><div className="date-strip" role="group" aria-label="事务日期">{dates.map((date) => {
        const key = localDate(date);
        const count = tasksOnDate(matching, key).length;
        const selected = selectedDay === key;
        return <button key={key} className={selected ? "selected" : ""} aria-current={selected ? "date" : undefined} aria-label={`${date.getMonth() + 1}月${date.getDate()}日，周${weekdays[date.getDay()]}，${count}件事务`} onClick={() => setSelectedDay(key)}><strong>{date.getDate()}</strong><span>周{weekdays[date.getDay()]}</span>{count > 0 && <i aria-hidden="true" />}</button>;
      })}</div></div>}
      <div className="task-toolbar"><div className="task-tabs" role="group" aria-label="任务状态"><button className={!showDone ? "selected" : ""} aria-pressed={!showDone} onClick={() => setShowDone(false)}>待办 {openCount}</button><button className={showDone ? "selected" : ""} aria-pressed={showDone} onClick={() => setShowDone(true)}>已完成 {tasks.length - openCount}</button></div><div className="view-switch" role="group" aria-label="视图切换"><button className={view === "cards" ? "selected" : ""} aria-pressed={view === "cards"} onClick={() => setView("cards")}>卡牌</button><button className={view === "matrix" ? "selected" : ""} aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>四象限</button></div></div>
    </div>
    {view === "cards" ? <section className="task-schedule">
        <div className="stack-heading"><span>{selectedDay ? `${center.getMonth() + 1}月${center.getDate()}日` : "未安排"} · {ordered.length} 件事务</span><span>按时间顺序</span></div>
        {ordered.length ? <div className="card-stack" aria-label="当天事务卡牌">
          {ordered.map((task, index) => <div className="task-slide" data-task-id={task.id} key={task.id}><div className="task-timeline" aria-hidden="true"><span>{parseDue(task.due).time || "待定"}</span><i /><small>{String(index + 1).padStart(2, "0")}</small></div><article className="priority-card" aria-label={`事务 ${index + 1}：${task.title}`}>
            <div className="priority-card-top"><span className="card-count">{String(index + 1).padStart(2, "0")} / {String(ordered.length).padStart(2, "0")}</span><span className="priority-total">排序分 <strong>{priorityScore(task).toFixed(1)}</strong></span></div>
            <h2>{task.title}</h2><p className="card-due">{formatDue(task.due)} · {task.category}</p>
            {(["importance", "urgency"] as const).map((axis) => <div className={`score-control ${axis}`} key={axis}><div className="score-heading"><label htmlFor={`${axis}-${task.id}`}>{axis === "importance" ? "重要度" : "紧急度"}</label><output>{task[axis].toFixed(1)} <small>/ 10</small></output></div><input id={`${axis}-${task.id}`} type="range" min="0" max="10" step="0.1" value={task[axis]} onChange={(event) => updateScore(task.id, axis, Number(event.target.value))} style={{ background: `linear-gradient(to right, ${axis === "importance" ? "#426b82" : "#bd687d"} ${task[axis] * 10}%, #dce4e4 ${task[axis] * 10}%)` }} /><p>{task[axis === "importance" ? "importanceReason" : "urgencyReason"]}</p></div>)}
            <div className="card-actions"><button className="button button-outline" onClick={() => editTask(task)}>编辑详情</button><button className="button button-primary" onClick={() => toggle(task.id)}><Icon name="check" size={18} /> {task.done ? "恢复待办" : "标记完成"}</button></div>
          </article></div>)}
        </div> : <div className="empty-state">{selectedDay ? "这一天还没有事务，换个日期或添加一件事。" : "还没有未安排的事务。"}</div>}
      </section> : <div className="matrix-workspace"><p className="matrix-note">全部{showDone ? "已完成" : "待办"}事务 · 重要度与紧急度以 6.0 为分界</p><div className="matrix" aria-label="重要度与紧急度四象限">{quadrants.map((section) => <section className={`quadrant q-${section.id}`} key={section.id}><div className="quadrant-heading"><div><h2>{section.title}</h2><span>{section.action}</span></div><strong>{matching.filter((task) => quadrant(task) === section.id).length}</strong></div><div className="quadrant-body">{matching.filter((task) => quadrant(task) === section.id).sort((a, b) => priorityScore(b) - priorityScore(a)).map((task) => <TaskRow key={task.id} task={task} toggle={toggle} edit={() => editTask(task)} />)}</div></section>)}</div></div>}
  </div>;
}
