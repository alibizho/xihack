export type Task = {
  id: string;
  title: string;
  due: string;
  category: string;
  importance: number;
  urgency: number;
  importanceReason: string;
  urgencyReason: string;
  done: boolean;
};
export type TaskDraft = Omit<Task, "id" | "done">;

export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const scheduledDue = (date: string, time: string) => date ? `${date}${time ? ` ${time}` : ""}` : "待安排";
export function parseDue(due: string, now = new Date()): { date: string; time: string } {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const exact = due.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (exact) {
    const parsed = new Date(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]));
    if (parsed.getFullYear() !== Number(exact[1]) || parsed.getMonth() !== Number(exact[2]) - 1 || parsed.getDate() !== Number(exact[3])) return { date: "", time: "" };
    const time = exact[4] && Number(exact[4]) < 24 && Number(exact[5]) < 60 ? `${exact[4].padStart(2, "0")}:${exact[5]}` : "";
    return { date: localDate(parsed), time };
  }
  if (due.startsWith("明天")) date.setDate(date.getDate() + 1);
  else if (due.startsWith("后天")) date.setDate(date.getDate() + 2);
  else if (due.startsWith("下周")) {
    const weekday = "日一二三四五六".indexOf(due[2]);
    date.setDate(date.getDate() + (weekday < 0 ? 7 : 7 + (weekday - date.getDay() + 7) % 7));
  } else if (due.startsWith("周")) {
    const weekday = "日一二三四五六".indexOf(due[1]);
    if (weekday < 0) return { date: "", time: "" };
    date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7);
  } else if (!due.startsWith("今天")) return { date: "", time: "" };
  const time = due.match(/\b(\d{1,2}):(\d{2})\b/);
  return { date: localDate(date), time: time && Number(time[1]) < 24 && Number(time[2]) < 60 ? `${time[1].padStart(2, "0")}:${time[2]}` : "" };
}
export function formatDue(due: string, now = new Date()): string {
  const { date, time } = parseDue(due, now);
  if (!date) return due || "待安排";
  const today = localDate(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = new Date(`${date}T00:00:00`);
  const label = date === today ? "今天" : date === localDate(tomorrow) ? "明天" : `${day.getMonth() + 1}月${day.getDate()}日`;
  return `${label}${time ? ` ${time}` : ""}`;
}
export const compareByTime = (a: Pick<Task, "due" | "importance" | "urgency">, b: Pick<Task, "due" | "importance" | "urgency">) =>
  (parseDue(a.due).time || "99:99").localeCompare(parseDue(b.due).time || "99:99") || priorityScore(b) - priorityScore(a);
export const compareBySchedule = (a: Pick<Task, "due" | "importance" | "urgency">, b: Pick<Task, "due" | "importance" | "urgency">) =>
  (parseDue(a.due).date || "9999-12-31").localeCompare(parseDue(b.due).date || "9999-12-31") || compareByTime(a, b);
export const tasksOnDate = (tasks: Task[], date: string) => tasks.filter((task) => parseDue(task.due).date === date).sort(compareByTime);

const sampleNow = new Date();
const sampleTomorrow = new Date(sampleNow.getFullYear(), sampleNow.getMonth(), sampleNow.getDate() + 1);

export const sampleTasks: Task[] = [
  { id: "1", title: "完成项目周报", due: scheduledDue(localDate(sampleNow), "15:00"), category: "学习", importance: 8.2, urgency: 9.0, importanceReason: "项目交付影响后续安排", urgencyReason: "今天截止", done: false },
  { id: "2", title: "准备下周的英语展示", due: scheduledDue(localDate(sampleNow), "18:00"), category: "学习", importance: 7.6, urgency: 4.2, importanceReason: "展示需要提前准备", urgencyReason: "还有准备时间", done: false },
  { id: "3", title: "预约牙医复诊", due: scheduledDue(localDate(sampleTomorrow), "10:00"), category: "生活", importance: 6.7, urgency: 7.8, importanceReason: "健康安排需要落实", urgencyReason: "明天前需要预约", done: false },
  { id: "4", title: "整理书桌和资料", due: "待安排", category: "生活", importance: 3.8, urgency: 2.9, importanceReason: "未说明明确后果", urgencyReason: "没有截止时间", done: false },
];

export const voiceExamples = [
  "明天下午三点交项目周报，很重要",
  "周五前准备英语展示，不着急但很重要",
  "记得预约牙医复诊",
];

export const priorityScore = (task: Pick<Task, "importance" | "urgency">) =>
  Math.round((task.importance * 0.6 + task.urgency * 0.4) * 10) / 10;
export const quadrant = (task: Pick<Task, "importance" | "urgency">) =>
  task.importance >= 6 ? (task.urgency >= 6 ? 0 : 1) : task.urgency >= 6 ? 2 : 3;

export function normalizeTask(value: Task & { important?: boolean; urgent?: boolean }): Task {
  const example = sampleTasks.find((task) => task.id === value.id && task.title === value.title);
  const migrated = value.importanceReason === "旧版任务迁移值";
  const due = parseDue(value.due || "");
  return {
    ...value,
    due: due.date ? scheduledDue(due.date, due.time) : value.due || "待安排",
    importance: !migrated && typeof value.importance === "number" ? value.importance : example?.importance ?? (value.important ? 7.5 : 4),
    urgency: !migrated && typeof value.urgency === "number" ? value.urgency : example?.urgency ?? (value.urgent ? 7.5 : 3),
    importanceReason: migrated ? example?.importanceReason || value.importanceReason : value.importanceReason || example?.importanceReason || "旧版任务迁移值",
    urgencyReason: migrated ? example?.urgencyReason || value.urgencyReason : value.urgencyReason || example?.urgencyReason || "旧版任务迁移值",
  };
}

const chineseDigit: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
function dueFromText(text: string, now: Date): string {
  const date = new Date(now);
  if (/明天/.test(text)) date.setDate(date.getDate() + 1);
  else if (/后天/.test(text)) date.setDate(date.getDate() + 2);
  else if (/下周/.test(text)) date.setDate(date.getDate() + 7);
  else if (/周[一二三四五六日]/.test(text)) {
    const weekday = "日一二三四五六".indexOf(text.match(/周([一二三四五六日])/)?.[1] || "");
    date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7);
  } else if (!/今天/.test(text)) return "待安排";
  const time = text.match(/(上午|下午|晚上)?\s*([一二三四五六七八九十]|\d{1,2})点/);
  let hour = time ? Number(chineseDigit[time[2]] ?? time[2]) : 0;
  if (time?.[1] === "下午" || time?.[1] === "晚上") hour = hour < 12 ? hour + 12 : hour;
  return scheduledDue(localDate(date), time ? `${String(hour).padStart(2, "0")}:00` : "");
}

// Demo-only scoring. The real interpretation endpoint replaces this heuristic.
export function mockProposal(text: string, now = new Date()): TaskDraft {
  const clean = text.trim().replace(/[。！!，,]+$/, "");
  if (!clean) throw new Error("请先输入一件要做的事");
  const importance = /不重要/.test(clean) ? 2.4 : /非常重要|特别重要/.test(clean) ? 9.2 : /重要/.test(clean) ? 7.8 : /项目|考试|展示|报告/.test(clean) ? 7.1 : /牙医|体检|客户/.test(clean) ? 6.7 : 5.0;
  const urgency = /不着急|不急/.test(clean) ? 2.6 : /马上|立刻|尽快/.test(clean) ? 9.4 : /今天/.test(clean) ? 9.0 : /明天/.test(clean) ? 8.0 : /后天/.test(clean) ? 6.8 : /周[一二三四五六日]|下周/.test(clean) ? 6.2 : 3.0;
  return {
    title: clean.replace(/^(记得|提醒我|请帮我)/, "").replace(/[，,].*$/, ""),
    due: dueFromText(clean, now),
    category: /牙医|买|妈妈|体检/.test(clean) ? "生活" : "学习",
    importance,
    urgency,
    importanceReason: importance === 5 ? "没有明确的影响信息，暂用中间值" : /重要/.test(clean) ? "根据你对重要性的表述" : "根据事项类型估计",
    urgencyReason: /不着急|不急/.test(clean) ? "你说了不着急" : /今天|明天|后天|周|马上|立刻|尽快/.test(clean) ? "根据时间或紧急表达估计" : "没有截止时间，暂按较低紧急度",
  };
}
