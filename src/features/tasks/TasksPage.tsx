import { useEffect, useState } from "react";
import { formatDue, localDate, parseDue, priorityScore, quadrant, tasksOnDate, type Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import { fill, getLang, t, uiLocale } from "../../shared/i18n.ts";
import { TaskRow } from "./TaskRow";
import { EventTreeView } from "./EventTreeView";
import "./TasksPage.css";

const quadrants = [
  { id: 1, title: () => t("qTitle1"), action: () => t("qAction1") },
  { id: 0, title: () => t("qTitle0"), action: () => t("qAction0") },
  { id: 3, title: () => t("qTitle3"), action: () => t("qAction3") },
  { id: 2, title: () => t("qTitle2"), action: () => t("qAction2") },
];
const zhWeekdays = ["日", "一", "二", "三", "四", "五", "六"];
const enWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Props = {
  serverMode?: boolean;
  tasks: Task[];
  initialDay?: string;
  toggle: (id: string) => void;
  updateScore: (id: string, axis: "importance" | "urgency", value: number) => void;
  openComposer: (voice?: boolean) => void;
  editTask: (task: Task) => void;
  openReport: (task: Task) => void;
};

export function TasksPage({ serverMode = false, tasks, initialDay, toggle, updateScore, openComposer, editTask, openReport }: Props) {
  const [view, setView] = useState<"cards" | "matrix" | "tree">("cards");
  const [showDone, setShowDone] = useState(false);
  const [selectedDay, setSelectedDay] = useState(initialDay ?? localDate(new Date()));
  const matching = tasks.filter((task) => task.done === showDone);
  const ordered = tasksOnDate(matching, selectedDay);
  const openCount = tasks.filter((task) => !task.done).length;
  const weekdays = getLang() === "zh" ? zhWeekdays : enWeekdays;
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
    <header className="tasks-intro"><div><h1>{t("tasksHeading")}</h1><p>{fill("tasksOpenCount", { n: openCount, mode: serverMode ? t("accountTasks") : t("browserTasks") })}</p></div><button className="button button-primary" onClick={() => openComposer(true)} aria-label={t("voiceAdd")}><Icon name="mic" size={18} /><span>{t("voiceAdd")}</span></button></header>
    <div className="task-workspace">
      <div className="task-add-row"><strong>{t("taskSchedule")}</strong><button className="button button-primary" onClick={() => openComposer(false)}><Icon name="plus" size={17} /> {t("addTask")}</button></div>
      {view === "cards" && <div className="date-picker"><div className="date-picker-head"><strong>{new Intl.DateTimeFormat(uiLocale(), { year: "numeric", month: "long" }).format(center)}</strong><div className="date-picker-actions"><button className="week-step" onClick={() => changeWeek(-1)} aria-label={t("prevWeek")}>‹</button><button className="week-step" onClick={() => changeWeek(1)} aria-label={t("nextWeek")}>›</button><button className={selectedDay ? "unscheduled-button" : "unscheduled-button selected"} onClick={() => setSelectedDay("")}>{t("unscheduled")} {matching.filter((task) => !parseDue(task.due).date).length}</button></div></div><div className="date-strip" role="group" aria-label={t("datesAria")}>{dates.map((date) => {
        const key = localDate(date);
        const count = tasksOnDate(matching, key).length;
        const selected = selectedDay === key;
        return <button key={key} className={selected ? "selected" : ""} aria-current={selected ? "date" : undefined} aria-label={fill("weekdayTaskAria", { date: `${date.getMonth() + 1}/${date.getDate()}`, weekday: weekdays[date.getDay()], n: count })} onClick={() => setSelectedDay(key)}><strong>{date.getDate()}</strong><span>{weekdays[date.getDay()]}</span>{count > 0 && <i aria-hidden="true" />}</button>;
      })}</div></div>}
      <div className="task-toolbar"><div className="task-tabs" role="group" aria-label={t("statusAria")}><button className={!showDone ? "selected" : ""} aria-pressed={!showDone} onClick={() => setShowDone(false)}>{t("todoTab")} {openCount}</button><button className={showDone ? "selected" : ""} aria-pressed={showDone} onClick={() => setShowDone(true)}>{t("doneTab")} {tasks.length - openCount}</button></div><div className="view-switch" role="group" aria-label={t("viewAria")}><button className={view === "cards" ? "selected" : ""} aria-pressed={view === "cards"} onClick={() => setView("cards")}>{t("cardsView")}</button><button className={view === "matrix" ? "selected" : ""} aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>{t("matrixView")}</button><button className={view === "tree" ? "selected" : ""} aria-pressed={view === "tree"} onClick={() => setView("tree")}>{t("eventTreeView")}</button></div></div>
    </div>
    {view === "cards" ? <section className="task-schedule">
        <div className="stack-heading"><span>{selectedDay ? new Intl.DateTimeFormat(uiLocale(), { month: "long", day: "numeric" }).format(center) : t("unscheduled")} · {fill("tasksCount", { n: ordered.length })}</span><span>{t("byTime")}</span></div>
        {ordered.length ? <div className="card-stack" aria-label={t("dayCardsAria")}>
          {ordered.map((task, index) => <div className="task-slide" data-task-id={task.id} key={task.id}><div className="task-timeline" aria-hidden="true"><span>{parseDue(task.due).time || t("timeTbd")}</span><i /><small>{String(index + 1).padStart(2, "0")}</small></div><article className="priority-card" aria-label={fill("taskCardAria", { n: index + 1, title: task.title })}>
            <div className="priority-card-top"><span className="card-count">{String(index + 1).padStart(2, "0")} / {String(ordered.length).padStart(2, "0")}</span><span className="priority-total">{t("rankScore")} <strong>{priorityScore(task).toFixed(1)}</strong></span></div>
            <h2>{task.title}</h2><p className="card-due">{formatDue(task.due)} · {task.category}</p>
            {(["importance", "urgency"] as const).map((axis) => serverMode ? <div className={`score-control ${axis}`} key={axis}><div className="score-heading"><span>{axis === "importance" ? t("importanceLabel") : t("urgencyLabel")}</span><output>{task[axis].toFixed(1)} <small>/ 10</small></output></div></div> : <div className={`score-control ${axis}`} key={axis}><div className="score-heading"><label htmlFor={`${axis}-${task.id}`}>{axis === "importance" ? t("importanceLabel") : t("urgencyLabel")}</label><output>{task[axis].toFixed(1)} <small>/ 10</small></output></div><input id={`${axis}-${task.id}`} type="range" min="0" max="10" step="0.1" value={task[axis]} onChange={(event) => updateScore(task.id, axis, Number(event.target.value))} style={{ background: `linear-gradient(to right, ${axis === "importance" ? "#426b82" : "#bd687d"} ${task[axis] * 10}%, #dce4e4 ${task[axis] * 10}%)` }} /><p>{task[axis === "importance" ? "importanceReason" : "urgencyReason"]}</p></div>)}
            <div className="card-actions">{serverMode && task.done ? <button className="button button-outline" onClick={() => openReport(task)}>{t("viewReport")}</button> : <><button className="button button-outline" onClick={() => editTask(task)}>{t("editDetails")}</button><button className="button button-primary" onClick={() => toggle(task.id)}><Icon name="check" size={18} /> {task.done ? t("restoreTodo") : t("markDone")}</button></>}</div>
          </article></div>)}
        </div> : <div className="empty-state">{selectedDay ? t("emptyDay") : t("emptyUnscheduled")}</div>}
      </section> : view === "tree" ? <EventTreeView tasks={matching} serverMode={serverMode} toggle={toggle} editTask={editTask} openReport={openReport} /> : <div className="matrix-workspace"><p className="matrix-note">{showDone ? t("allDoneTasks") : t("allOpenTasks")} · {serverMode ? t("matrixNoteServer") : t("matrixNoteLocal")}</p><div className="matrix" aria-label={t("matrixAria")}>{quadrants.map((section) => <section className={`quadrant q-${section.id}`} key={section.id}><div className="quadrant-heading"><div><h2>{section.title()}</h2><span>{section.action()}</span></div><strong>{matching.filter((task) => quadrant(task) === section.id).length}</strong></div><div className="quadrant-body">{matching.filter((task) => quadrant(task) === section.id).sort((a, b) => priorityScore(b) - priorityScore(a)).map((task) => <TaskRow key={task.id} task={task} toggle={toggle} edit={serverMode && task.done ? undefined : () => editTask(task)} serverMode={serverMode} openReport={serverMode && task.done ? () => openReport(task) : undefined} />)}</div></section>)}</div></div>}
  </div>;
}
