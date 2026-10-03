import { localDate, parseDue, type Task } from "./mockTasks.ts";

export type ScheduledTask = { task: Task; date: string; time: string };
export type TreeDay = { date: string; tasks: ScheduledTask[] };
export type TreeWeek = { week: number; days: TreeDay[] };
export type TreeMonth = { month: number; weeks: TreeWeek[] };
export type TreeYear = { year: number; months: TreeMonth[] };

function compareTasks(a: ScheduledTask, b: ScheduledTask) {
  return a.date.localeCompare(b.date)
    || (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? 1 : b.time ? -1 : 0)
    || a.task.id.localeCompare(b.task.id);
}

export function weekOfMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const day = Number(date.slice(-2));
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return Math.floor((day - 1 + firstWeekday) / 7) + 1;
}

export function buildEventTree(tasks: Task[], today: string) {
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

export function distributeEventSides(items: ScheduledTask[]) {
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

export { localDate };
