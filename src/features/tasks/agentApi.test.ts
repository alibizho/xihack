import assert from "node:assert/strict";
import test from "node:test";
import { confirmProposal, getRunProposals, getTaskReport, listTasks, sendMessage, submitTaskReport, withLocalContext } from "./agentApi.ts";
import { displayTask, taskInput } from "./serverTasks.ts";

test("task scores survive API display and edit conversion", () => {
  const serverTask = { task_id: "task-1", title: "Submit homework", description: null, category: "学习", due: null, importance: 7.3, urgency: 8.6, status: "open" as const, version: 1 };
  const displayed = displayTask(serverTask);
  assert.equal(displayed.importance, 7.3);
  assert.equal(displayed.urgency, 8.6);
  assert.deepEqual({ importance: taskInput(displayed).importance, urgency: taskInput(displayed).urgency }, { importance: 7.3, urgency: 8.6 });
});

test("narrated tasks carry the user's local date for relative deadlines", async () => {
  const original = globalThis.fetch;
  let body: { content: string } | undefined;
  globalThis.fetch = async (_path, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ run_id: "run-1" }), { status: 202 });
  };
  try {
    const payload = withLocalContext("明天得交作业");
    await sendMessage("conversation-1", payload, "message-1", "csrf-token");
    assert.match(body?.content || "", /^\[应用提供的用户本地时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}；时区：.+\]\n明天得交作业$/);
    assert.equal(body?.content, payload);
  } finally { globalThis.fetch = original; }
});

test("account tasks paginate and Agent proposals require explicit confirmation", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), init: init || {} });
    if (String(path).startsWith("/api/tasks")) {
      const second = String(path).includes("cursor=next");
      return new Response(JSON.stringify({ items: [{ task_id: second ? "two" : "one" }], next_cursor: second ? null : "next" }));
    }
    if (String(path) === "/api/runs/run-1/proposals") return new Response(JSON.stringify([{ proposal_id: "proposal-1", status: "pending" }]));
    return new Response(JSON.stringify({ task_id: "one" }));
  };
  try {
    assert.deepEqual((await listTasks()).map((task) => task.task_id), ["one", "two"]);
    assert.equal((await getRunProposals("run-1"))[0].status, "pending");
    await confirmProposal("proposal-1", "same-confirm-key", "csrf-token");
    assert.equal(calls[3].path, "/api/proposals/proposal-1/confirm");
    assert.equal((calls[3].init.headers as Record<string, string>)["X-CSRF-Token"], "csrf-token");
    assert.deepEqual(JSON.parse(String(calls[3].init.body)), { idempotency_key: "same-confirm-key" });
  } finally { globalThis.fetch = original; }
});

test("completion report is saved for the selected task with CSRF", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), init: init || {} });
    return new Response(JSON.stringify({ report_id: "report-1", task_id: "task-1", body: "Done", status: "analyzed" }));
  };
  try {
    assert.equal((await submitTaskReport("task-1", "Done", "csrf-token")).status, "analyzed");
    assert.equal((await getTaskReport("task-1")).report_id, "report-1");
    assert.equal(calls[0].path, "/api/tasks/task-1/report");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-CSRF-Token"], "csrf-token");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { body: "Done" });
  } finally { globalThis.fetch = original; }
});
