import { useEffect, useState } from "react";
import { Icon } from "../../shared/Icon";
import { t, uiLocale } from "../../shared/i18n.ts";
import type { ServerTask } from "./agentApi";
import "./TaskResultCarousel.css";

function dateLabel(task: ServerTask) {
  if (!task.due) return t("dateUnset");
  if (task.due.precision === "date") {
    return new Intl.DateTimeFormat(uiLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${task.due.date}T00:00:00Z`));
  }
  return new Intl.DateTimeFormat(uiLocale(), { dateStyle: "medium", timeZone: task.due.timezone }).format(new Date(task.due.at));
}

function categoryLabel(category: string | null) {
  const key = category?.trim().toLowerCase();
  const values: Record<string, [string, string]> = {
    "学习": ["学习", "Study"], study: ["学习", "Study"], education: ["学习", "Study"],
    "生活": ["生活", "Life"], life: ["生活", "Life"], personal: ["生活", "Life"],
    "工作": ["工作", "Work"], work: ["工作", "Work"],
    "健康": ["健康", "Health"], health: ["健康", "Health"],
    "其他": ["其他", "Other"], other: ["其他", "Other"],
  };
  return key && values[key] ? values[key][uiLocale() === "en-US" ? 1 : 0] : category || t("uncategorized");
}

export function TaskResultCarousel({ tasks, recommendedTaskId }: { tasks: ServerTask[]; recommendedTaskId: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!tasks.length) { setIndex(0); return; }
    const recommended = tasks.findIndex((task) => task.task_id === recommendedTaskId);
    setIndex(recommended >= 0 ? recommended : 0);
  }, [tasks, recommendedTaskId]);
  if (!tasks.length) return null;
  const visibleIndex = Math.min(index, tasks.length - 1);
  const task = tasks[visibleIndex];
  const due = task.due?.precision === "minute"
    ? new Intl.DateTimeFormat(uiLocale(), { timeStyle: "short", timeZone: task.due.timezone }).format(new Date(task.due.at))
    : task.due ? t("allDay") : t("dateUnset");
  return <section className="task-result-area" aria-label={t("taskResultLabel")}>
    <div className="task-result-stage">
      {tasks.length > 1 && <button className="proposal-nav" type="button" disabled={visibleIndex === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} aria-label={t("proposalPrevious")}><Icon name="chevronLeft" size={22} /></button>}
      <article className="task-result-card" key={task.task_id}>
        <div className="task-result-kicker">{task.task_id === recommendedTaskId ? t("recommendedTaskLabel") : t("existingTaskLabel")}</div>
        <h3>{task.title}</h3>
        {task.description && <p className="task-result-description">{task.description}</p>}
        <dl className="task-result-details">
          <dt>{t("dateLabel")}</dt><dd>{dateLabel(task)}{task.due ? ` ${due}` : ""}</dd>
          <dt>{t("categoryLabel")}</dt><dd>{categoryLabel(task.category)}</dd>
          <dt>{t("importanceLabel")}</dt><dd>{task.importance.toFixed(1)} / 10</dd>
          <dt>{t("urgencyLabel")}</dt><dd>{task.urgency.toFixed(1)} / 10</dd>
          <dt>{t("taskStatusLabel")}</dt><dd>{task.status === "completed" ? t("taskCompleted") : t("taskOpen")}</dd>
        </dl>
      </article>
      {tasks.length > 1 && <button className="proposal-nav" type="button" disabled={visibleIndex >= tasks.length - 1} onClick={() => setIndex((value) => Math.min(tasks.length - 1, value + 1))} aria-label={t("proposalNext")}><Icon name="chevronRight" size={22} /></button>}
    </div>
    {tasks.length > 1 && <p className="proposal-progress" aria-live="polite">{visibleIndex + 1} / {tasks.length}</p>}
  </section>;
}
