import assert from "node:assert/strict";
import test from "node:test";
import { compareBySchedule, localDate, mockProposal, normalizeTask, parseDue, priorityScore, scheduledDue, tasksOnDate } from "./mockTasks.ts";
import { transcribeTask } from "./mockTaskApi.ts";

test("demo scoring keeps importance separate from deadline and accepts decimals", () => {
  assert.throws(() => mockProposal("  "));
  assert.equal(mockProposal("明天下午三点交项目周报，很重要").importance, 7.8);
  assert.equal(mockProposal("明天下午三点交项目周报，很重要").urgency, 8);
  assert.equal(mockProposal("不着急但很重要").urgency, 2.6);
  assert.equal(mockProposal("明天整理书桌").importance, 5);
  assert.equal(priorityScore({ importance: 7.2, urgency: 3.3 }), 5.6);
  assert.equal(normalizeTask({ id: "old", title: "旧任务", due: "", category: "", done: false, important: true, urgent: false } as never).importance, 7.5);
  assert.equal(normalizeTask({ id: "1", title: "完成项目周报", due: "", category: "", done: false, importance: 7.5, urgency: 7.5, importanceReason: "旧版任务迁移值", urgencyReason: "旧版任务迁移值" } as never).importance, 8.2);
});

test("mock transcription requires recorded audio", async () => {
  await assert.rejects(() => transcribeTask(new Blob([])));
  assert.ok((await transcribeTask(new Blob(["demo"]))).text);
});

test("date and time pickers place each task on its day in time order", () => {
  const now = new Date(2026, 9, 2);
  assert.deepEqual(parseDue("今天 15:00", now), { date: "2026-10-02", time: "15:00" });
  assert.deepEqual(parseDue("2026/10/03 09:05"), { date: "2026-10-03", time: "09:05" });
  assert.equal(mockProposal("明天下午三点交项目周报", now).due, "2026-10-03 15:00");
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
