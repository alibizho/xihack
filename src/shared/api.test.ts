import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, api, post } from "./api.ts";

test("voice messages use the authenticated same-origin API and CSRF token", async () => {
  const original = globalThis.fetch;
  let path = "";
  let init: RequestInit = {};
  globalThis.fetch = async (url, options) => {
    path = String(url);
    init = options || {};
    return new Response(JSON.stringify({ run_id: "run-1" }), { status: 202 });
  };
  try {
    const result = await post<{ run_id: string }>("/conversations/c1/messages", { client_message_id: "m1", content: "你好" }, "csrf-1");
    assert.deepEqual(result, { run_id: "run-1" });
    assert.equal(path, "/api/conversations/c1/messages");
    assert.equal(init.credentials, "include");
    assert.equal((init.headers as Record<string, string>)["X-CSRF-Token"], "csrf-1");
    assert.deepEqual(JSON.parse(String(init.body)), { client_message_id: "m1", content: "你好" });
  } finally { globalThis.fetch = original; }
});

test("expired sessions give a login prompt", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "AUTH_REQUIRED" }), { status: 401 });
  try { await assert.rejects(() => api("/auth/me"), (error: unknown) => error instanceof ApiRequestError && error.code === "AUTH_REQUIRED"); }
  finally { globalThis.fetch = original; }
});

test("logout accepts an empty successful response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try { assert.equal(await post<void>("/auth/logout", {}, "csrf-1"), undefined); }
  finally { globalThis.fetch = original; }
});
