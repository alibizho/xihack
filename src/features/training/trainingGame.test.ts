import assert from "node:assert/strict";
import test from "node:test";
import { cellFeedback, shuffledBoard } from "./trainingGame.ts";

test("board has 1–25 once and difficulty feedback follows the rules", () => {
  const board = shuffledBoard(() => 0.37);
  assert.deepEqual([...board].sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal(cellFeedback("beginner", 4, 4), "next");
  assert.equal(cellFeedback("beginner", 3, 4), "done");
  assert.equal(cellFeedback("normal", 4, 4), "idle");
  assert.equal(cellFeedback("normal", 3, 4), "done");
  assert.equal(cellFeedback("advanced", 3, 4), "idle");
});
