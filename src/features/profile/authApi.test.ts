import assert from "node:assert/strict";
import test from "node:test";
import { currentUser, login, logout, register } from "./authApi.ts";

test("sign-up, login, session restore, and logout use cookie auth", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: String(url), init });
    if (String(url).endsWith("/csrf")) return Response.json({ csrf_token: "token" });
    if (String(url).endsWith("/logout")) return new Response(null, { status: 204 });
    return Response.json({ user: { username: "alice" } });
  };
  try {
    assert.equal((await register("alice", "a-long-password-123")).user.username, "alice");
    assert.equal((await login("alice", "a-long-password-123")).user.username, "alice");
    assert.equal((await currentUser()).user.username, "alice");
    await logout();
    assert.deepEqual(calls.map((call) => call.path), ["/api/auth/register", "/api/auth/login", "/api/auth/me", "/api/auth/csrf", "/api/auth/logout"]);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { username: "alice", password: "a-long-password-123", adult_declared: true });
    assert.equal((calls[4].init.headers as Record<string, string>)["X-CSRF-Token"], "token");
    assert.ok(calls.every((call) => call.init.credentials === "include"));
  } finally { globalThis.fetch = original; }
});
