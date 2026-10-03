import assert from "node:assert/strict";
import test from "node:test";
import { confirmProposal, getRunProposals, getTaskReport, listTasks, submitTaskReport } from "./agentApi.ts";

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
