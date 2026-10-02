import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleTrainingFeedback } from "./trainingFeedback.ts";

const round = { difficulty: "normal", seconds: 25, mistakes: 2, taps: Array.from({ length: 25 }, (_, index) => index + 1) };

test("training feedback validates a round, calls MiMo with derived metrics, and keeps the key server-side", async () => {
  const realFetch = globalThis.fetch;
  const server = createServer((request, response) => { void handleTrainingFeedback(request, response, { MIMO_API_KEY: "sk-test", MIMO_BASE_URL: "https://api.xiaomimimo.com/v1" }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/training-feedback`;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.xiaomimimo.com/v1/chat/completions");
      assert.equal((init?.headers as Record<string, string>)["api-key"], "sk-test");
      const requestBody = JSON.parse(String(init?.body));
      assert.equal(requestBody.model, "mimo-v2.6-flash");
      assert.equal(requestBody.thinking.type, "disabled");
      assert.equal(requestBody.messages[1].content.includes("taps"), false);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ observation: "本局点击节奏平稳，误触 2 次。", suggestion: "下次试试保持准确点击。" }) } }] });
    };
    const success = await realFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(round) });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { observation: "本局点击节奏平稳，误触 2 次。", suggestion: "下次试试保持准确点击。" });
    const invalid = await realFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...round, taps: [1, 2] }) });
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
