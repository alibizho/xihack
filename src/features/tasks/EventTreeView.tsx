import { useMemo, useRef, useState } from "react";
import { localDate, parseDue, type Task } from "./mockTasks";
import { fill, t, uiLocale } from "../../shared/i18n.ts";
import "./EventTreeView.css";

type Props = {
  tasks: Task[];
  serverMode: boolean;
  toggle: (id: string) => void;
  editTask: (task: Task) => void;
  openReport: (task: Task) => void;
};

type ScheduledTask = { task: Task; date: string; time: string };
type TreeDay = { date: string; tasks: ScheduledTask[] };
type TreeWeek = { week: number; days: TreeDay[] };
type TreeMonth = { month: number; weeks: TreeWeek[] };
type TreeYear = { year: number; months: TreeMonth[] };

function compareTasks(a: ScheduledTask, b: ScheduledTask) {
  return a.date.localeCompare(b.date)
    || (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? 1 : b.time ? -1 : 0)
    || a.task.id.localeCompare(b.task.id);
}

function weekOfMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const day = Number(date.slice(-2));
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return Math.floor((day - 1 + firstWeekday) / 7) + 1;
}

function buildTree(tasks: Task[], today: string) {
  const scheduled: ScheduledTask[] = [];
  const unscheduled: Task[] = [];
  for (const task of tasks) {
    const due = parseDue(task.due);
    if (due.date) scheduled.push({ task, date: due.date, time: due.time });
    else unscheduled.push(task);
  }
  scheduled.sort(compareTasks);

  const byDate = new Map<string, ScheduledTask[]>();
  for (const item of scheduled) {
    const day = byDate.get(item.date) ?? [];
    day.push(item);
    byDate.set(item.date, day);
  }
  if (!byDate.has(today)) byDate.set(today, []);

  const years: TreeYear[] = [];
  const yearMap = new Map<number, TreeYear>();
  const monthMap = new Map<string, TreeMonth>();
  const weekMap = new Map<string, TreeWeek>();
  for (const date of [...byDate.keys()].sort()) {
    const [year, month] = date.split("-").map(Number);
    let yearGroup = yearMap.get(year);
    if (!yearGroup) {
      yearGroup = { year, months: [] };
      yearMap.set(year, yearGroup);
      years.push(yearGroup);
    }
    const monthKey = `${year}-${month}`;
    let monthGroup = monthMap.get(monthKey);
    if (!monthGroup) {
      monthGroup = { month, weeks: [] };
      monthMap.set(monthKey, monthGroup);
      yearGroup.months.push(monthGroup);
    }
    const week = weekOfMonth(date);
    const weekKey = `${monthKey}-${week}`;
    let weekGroup = weekMap.get(weekKey);
    if (!weekGroup) {
      weekGroup = { week, days: [] };
      weekMap.set(weekKey, weekGroup);
      monthGroup.weeks.push(weekGroup);
    }
    weekGroup.days.push({ date, tasks: byDate.get(date) ?? [] });
  }
  unscheduled.sort((a, b) => a.id.localeCompare(b.id));
  return { years, unscheduled, scheduled };
}

function distributeSides(items: ScheduledTask[]) {
  const sides = new Map<string, "left" | "right">();
  let leftLoad = 0;
  let rightLoad = 0;
  let tiedSide: "left" | "right" = "left";
  for (const { task } of items) {
    const side: "left" | "right" = leftLoad < rightLoad ? "left" : rightLoad < leftLoad ? "right" : tiedSide;
    const estimatedHeight = 142 + Math.ceil(Array.from(task.title).length / 27) * 22;
    sides.set(task.id, side);
    if (side === "left") leftLoad += estimatedHeight;
    else rightLoad += estimatedHeight;
    tiedSide = side === "left" ? "right" : "left";
  }
  return sides;
}

export function EventTreeView({ tasks, serverMode, toggle, editTask, openReport }: Props) {
  const today = localDate(new Date());
  const todayRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { years, unscheduled, scheduled } = useMemo(() => buildTree(tasks, today), [tasks, today]);
  const sides = useMemo(() => distributeSides(scheduled), [scheduled]);
  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function jumpToToday() {
    const [year, month] = today.split("-");
    const week = weekOfMonth(today);
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(`year-${year}`);
      next.delete(`month-${year}-${month}`);
      next.delete(`week-${year}-${month}-${week}`);
      return next;
    });
    window.requestAnimationFrame(() => todayRef.current?.scrollIntoView({ block: "center", behavior: "auto" }));
  }

  return <section className="event-tree-view" aria-label={t("eventTreeAria")}>
    <div className="event-tree-toolbar">
      <p><strong>{fill("scheduledCount", { n: scheduled.length })}</strong><span aria-hidden="true">　</span><span>{fill("unscheduledCount", { n: unscheduled.length })}</span></p>
      <button className="event-tree-today-button" onClick={jumpToToday}>{t("jumpToday")}</button>
    </div>

    {scheduled.length === 0 && <p className="event-tree-empty">{t("noScheduledTasks")}</p>}

    <div className="event-tree-scheduled">
      <div className="event-tree-spine" aria-hidden="true" />
      {years.map((year) => {
        const yearKey = `year-${year.year}`;
        const isYearCollapsed = collapsed.has(yearKey);
        return <section className="event-tree-year" key={year.year}>
        <h2 className="event-tree-marker event-tree-year-marker"><button className="event-tree-disclosure" aria-expanded={!isYearCollapsed} onClick={() => toggleGroup(yearKey)}><span>{fill("yearLabel", { year: year.year })}</span><span className="event-tree-disclosure-mark" aria-hidden="true">{isYearCollapsed ? "+" : "−"}</span></button></h2>
        {!isYearCollapsed && year.months.map((month) => {
          const monthKey = `month-${year.year}-${month.month}`;
          const isMonthCollapsed = collapsed.has(monthKey);
          return <section className="event-tree-month" key={`${year.year}-${month.month}`}>
          <h3 className="event-tree-marker event-tree-month-marker"><button className="event-tree-disclosure" aria-expanded={!isMonthCollapsed} onClick={() => toggleGroup(monthKey)}><span>{fill("monthLabel", { month: month.month })}</span><span className="event-tree-disclosure-mark" aria-hidden="true">{isMonthCollapsed ? "+" : "−"}</span></button></h3>
          {!isMonthCollapsed && month.weeks.map((week) => {
            const weekKey = `week-${year.year}-${month.month}-${week.week}`;
            const isWeekCollapsed = collapsed.has(weekKey);
            return <section className="event-tree-week" key={`${year.year}-${month.month}-${week.week}`}>
            <h4 className="event-tree-marker event-tree-week-marker"><button className="event-tree-disclosure" aria-expanded={!isWeekCollapsed} onClick={() => toggleGroup(weekKey)}><span>{fill("weekLabel", { week: week.week })}</span><span className="event-tree-disclosure-mark" aria-hidden="true">{isWeekCollapsed ? "+" : "−"}</span></button></h4>
            {!isWeekCollapsed && week.days.map((day) => {
              const [dayYear, dayMonth, dayNumber] = day.date.split("-").map(Number);
              const isToday = day.date === today;
              return <section className={`event-tree-day ${isToday ? "is-today" : ""}`} key={day.date}>
                <h5 className="event-tree-marker event-tree-day-marker" ref={isToday ? todayRef : undefined}>
                  <span>{new Intl.DateTimeFormat(uiLocale(), { month: "long", day: "numeric" }).format(new Date(dayYear, dayMonth - 1, dayNumber))}{isToday && <em>{t("todayLabel")}</em>}<small>{new Intl.DateTimeFormat(uiLocale(), { weekday: "long" }).format(new Date(dayYear, dayMonth - 1, dayNumber))}</small></span>
                </h5>
                {day.tasks.length > 0
                  ? <ol className="event-tree-events" aria-label={fill("dayTasksAria", { month: dayMonth, day: dayNumber })}>
                    {day.tasks.map(({ task, time }) => <li className={`event-tree-event side-${sides.get(task.id) ?? "left"}`} key={task.id}>
                      <span className="event-tree-node" aria-hidden="true" />
                      <article className={`event-tree-card ${task.done ? "is-done" : ""}`}>
                        <div className="event-tree-card-meta">
                          {time ? <time dateTime={time}>{time}</time> : <span>{t("allDay")}</span>}
                          {task.done && <span className="event-tree-status">{t("completedStatus")}</span>}
                          {!task.done && task.urgency >= 8 && <span className="event-tree-urgent">{t("urgentStatus")}</span>}
                        </div>
                        <h6>{task.title}</h6>
                        <p className="event-tree-category">{task.category || t("uncategorizedTasks")}</p>
                        <div className="event-tree-actions">
                          {serverMode && task.done
                              ? <button className="button button-outline" onClick={() => openReport(task)}>{t("viewReport")}</button>
                            : <>
                              <button className="button button-outline" onClick={() => editTask(task)}>{t("editDetails")}</button>
                              <button className="button button-primary" onClick={() => toggle(task.id)}>{task.done ? t("restoreTodo") : t("markDone")}</button>
                            </>}
                        </div>
                      </article>
                    </li>)}
                  </ol>
                  : isToday && <p className="event-tree-today-empty">{t("todayEmpty")}</p>}
              </section>;
            })}
          </section>;
          })}
        </section>;
        })}
      </section>;
      })}
    </div>

    {unscheduled.length > 0 && <section className="event-tree-unplanned" aria-labelledby="event-tree-unplanned-heading">
      <div className="event-tree-unplanned-heading"><span className="event-tree-unplanned-branch" aria-hidden="true" /><div><h2 id="event-tree-unplanned-heading">{t("unplanned")}</h2><p>{t("unplannedHint")}</p></div></div>
      <ul className="event-tree-unplanned-list">
        {unscheduled.map((task) => <li key={task.id}>
          <article className={`event-tree-card ${task.done ? "is-done" : ""}`}>
            <div className="event-tree-card-meta">
              <span>{t("eventTimeTbd")}</span>
              {task.done && <span className="event-tree-status">{t("completedStatus")}</span>}
              {!task.done && task.urgency >= 8 && <span className="event-tree-urgent">{t("urgentStatus")}</span>}
            </div>
            <h3>{task.title}</h3>
            <p className="event-tree-category">{task.category || t("uncategorizedTasks")}</p>
            <div className="event-tree-actions">
              {serverMode && task.done
                ? <button className="button button-outline" onClick={() => openReport(task)}>{t("viewReport")}</button>
                : <>
                  <button className="button button-outline" onClick={() => editTask(task)}>{t("editDetails")}</button>
                  <button className="button button-primary" onClick={() => toggle(task.id)}>{task.done ? t("restoreTodo") : t("markDone")}</button>
                </>}
            </div>
          </article>
        </li>)}
      </ul>
    </section>}
  </section>;
}
