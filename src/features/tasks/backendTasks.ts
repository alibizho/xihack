import type { BackendDue, BackendTask, TaskInput } from "../../shared/backendApi";
import { parseDue, type Task, type TaskDraft } from "./mockTasks";

export function displayDue(due: BackendDue): string {
  if (!due) return "待安排";
  if (due.precision === "date") return due.date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(due.at));
  const value = (name: string) => parts.find((part) => part.type === name)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

export function toDisplayTask(task: BackendTask): Task {
  return {
    id: task.task_id,
    title: task.title,
    due: displayDue(task.due),
    category: task.category || "未分类",
    importance: task.important ? 10 : 0,
    urgency: task.urgent ? 10 : 0,
    importanceReason: task.important ? "已标记为重要" : "未标记为重要",
    urgencyReason: task.urgent ? "已标记为紧急" : "未标记为紧急",
    done: task.status === "completed",
  };
}

function backendDue(value: string): BackendDue {
  const { date, time } = parseDue(value);
  if (!date) return null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!time) return { precision: "date", date, timezone };
  const local = new Date(`${date}T${time}:00`);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const hh = String(Math.floor(absolute / 60)).padStart(2, "0");
  const mm = String(absolute % 60).padStart(2, "0");
  return { precision: "minute", at: `${date}T${time}:00${sign}${hh}:${mm}`, timezone };
}

export function toTaskInput(draft: TaskDraft): TaskInput {
  return {
    title: draft.title.trim(),
    description: null,
    category: draft.category.trim() || null,
    due: backendDue(draft.due),
    important: draft.importance >= 6,
    urgent: draft.urgency >= 6,
  };
}
