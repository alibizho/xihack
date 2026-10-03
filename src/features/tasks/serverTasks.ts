import { parseDue, type Task, type TaskDraft } from "./mockTasks";
import type { Due, ServerTask } from "./agentApi";

export function displayDue(due: Due): string {
  if (!due) return "待安排";
  if (due.precision === "date") return due.date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(due.at));
  const value = (name: string) => parts.find((part) => part.type === name)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

export function displayTask(task: ServerTask): Task {
  return {
    id: task.task_id, title: task.title, due: displayDue(task.due), category: task.category || "未分类",
    importance: task.important ? 10 : 0, urgency: task.urgent ? 10 : 0,
    importanceReason: task.important ? "重要" : "非重要", urgencyReason: task.urgent ? "紧急" : "非紧急",
    done: task.status === "completed",
  };
}

export function taskInput(draft: TaskDraft) {
  const { date, time } = parseDue(draft.due);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let due: Due = null;
  if (date && !time) due = { precision: "date", date, timezone };
  if (date && time) {
    const offset = -new Date(`${date}T${time}:00`).getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    const mm = String(Math.abs(offset) % 60).padStart(2, "0");
    due = { precision: "minute", at: `${date}T${time}:00${sign}${hh}:${mm}`, timezone };
  }
  return {
    title: draft.title.trim(), description: null, category: draft.category.trim() || null, due,
    important: draft.importance >= 6, urgent: draft.urgency >= 6,
  };
}
