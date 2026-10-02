import assert from "node:assert/strict";
import test from "node:test";
import { mockProposal } from "./mockTasks.ts";

test("mock proposal keeps importance separate from urgency", () => {
  assert.throws(() => mockProposal("  "));
  assert.equal(mockProposal("明天下午三点交项目周报，很重要").important, true);
  assert.equal(mockProposal("周五准备英语展示").urgent, false);
});
