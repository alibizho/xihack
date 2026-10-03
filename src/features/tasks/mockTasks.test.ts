import assert from "node:assert/strict";
import test from "node:test";
import { compareBySchedule, localDate, normalizeTask, parseDue, priorityScore, scheduledDue, tasksOnDate } from "./mockTasks.ts";

test("scoring keeps importance separate from deadline and accepts decimals", () => {
  assert.equal(priorityScore({ importance: 7.2, urgency: 3.3 }), 5.6);
  assert.equal(normalizeTask({ id: "old", title: "旧任务", due: "", category: "", done: false, important: true, urgent: false } as never).importance, 7.5);
  assert.equal(normalizeTask({ id: "1", title: "完成项目周报", due: "", category: "", done: false, importance: 7.5, urgency: 7.5, importanceReason: "旧版任务迁移值", urgencyReason: "旧版任务迁移值" } as never).importance, 8.2);
});

test("date and time pickers place each task on its day in time order", () => {
  const now = new Date(2026, 9, 2);
  assert.deepEqual(parseDue("今天 15:00", now), { date: "2026-10-02", time: "15:00" });
  assert.deepEqual(parseDue("2026/10/03 09:05"), { date: "2026-10-03", time: "09:05" });
  assert.equal(scheduledDue("", "10:00"), "待安排");
  const sameDay = [
    { due: "2026-10-02 18:00", importance: 9, urgency: 9 },
    { due: "2026-10-03 08:00", importance: 9, urgency: 9 },
    { due: "2026-10-02 09:00", importance: 2, urgency: 2 },
    { due: "2026-10-02", importance: 10, urgency: 10 },
  ].map((task, index) => ({ ...task, id: String(index), title: String(index), category: "", importanceReason: "", urgencyReason: "", done: false }));
  assert.deepEqual(tasksOnDate(sameDay, "2026-10-02").map((task) => task.due), ["2026-10-02 09:00", "2026-10-02 18:00", "2026-10-02"]);
  assert.deepEqual([...sameDay, { ...sameDay[0], due: "待安排" }].sort(compareBySchedule).map((task) => task.due), ["2026-10-02 09:00", "2026-10-02 18:00", "2026-10-02", "2026-10-03 08:00", "待安排"]);
  assert.equal(localDate(now), "2026-10-02");
});
