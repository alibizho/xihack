import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "./mockTasks.ts";
import { buildEventTree, distributeEventSides, weekOfMonth } from "./eventTreeModel.ts";

const makeTask = (id: string, due: string, done = false): Task => ({
  id,
  title: `Task ${id}`,
  due,
  category: "工作",
  importance: 5,
  urgency: 5,
  importanceReason: "用户设定",
  urgencyReason: "用户设定",
  done,
});

test("transaction time tree groups real tasks by date and keeps their state", () => {
  const completed = makeTask("completed", "2026-10-03", true);
  const later = makeTask("later", "2026-11-02 10:00");
  const earlier = makeTask("earlier", "2026-11-02 09:00");
  const unscheduledZ = makeTask("z-unscheduled", "待安排");
  const unscheduledA = makeTask("a-unscheduled", "待安排");

  const tree = buildEventTree([later, unscheduledZ, earlier, completed, unscheduledA], "2026-10-02");

  assert.deepEqual(tree.years.map((year) => year.year), [2026]);
  const october = tree.years[0].months.find((month) => month.month === 10)!;
  const today = october.weeks.flatMap((week) => week.days).find((day) => day.date === "2026-10-02");
  const completedDay = october.weeks.flatMap((week) => week.days).find((day) => day.date === "2026-10-03");
  assert.deepEqual(today?.tasks, []);
  assert.equal(completedDay?.tasks[0].task, completed);
  assert.equal(completedDay?.tasks[0].task.done, true);
  assert.deepEqual(tree.unscheduled.map((task) => task.id), ["a-unscheduled", "z-unscheduled"]);

  const november = tree.years[0].months.find((month) => month.month === 11)!;
  const ordered = november.weeks.flatMap((week) => week.days).find((day) => day.date === "2026-11-02");
  assert.deepEqual(ordered?.tasks.map((item) => [item.task.id, item.time]), [
    ["earlier", "09:00"],
    ["later", "10:00"],
  ]);
});

test("tree weeks start on Monday and card sides distribute by estimated height", () => {
  assert.equal(weekOfMonth("2026-10-01"), 1);
  assert.equal(weekOfMonth("2026-10-05"), 2);
  const items = [makeTask("one", "2026-10-02"), makeTask("two", "2026-10-03"), makeTask("three", "2026-10-04")]
    .map((task) => ({ task, date: task.due, time: "" }));
  const sides = distributeEventSides(items);
  assert.equal(sides.get("one"), "left");
  assert.equal(sides.get("two"), "right");
  assert.equal(sides.get("three"), "left");
});
