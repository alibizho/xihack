import assert from "node:assert/strict";
import test from "node:test";
import { cellFeedback, shuffledBoard, shuffledColors } from "./trainingGame.ts";
import { circularSegments } from "./circularBoard.ts";

test("board has 1–25 once and difficulty feedback follows the rules", () => {
  const board = shuffledBoard(() => 0.37);
  assert.deepEqual([...board].sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal(cellFeedback("beginner", 4, 4), "next");
  assert.equal(cellFeedback("beginner", 3, 4), "done");
  assert.equal(cellFeedback("normal", 4, 4), "idle");
  assert.equal(cellFeedback("normal", 3, 4), "done");
  assert.equal(cellFeedback("advanced", 3, 4), "idle");
});

test("grid colors are shuffled with five cells per pastel color", () => {
  const colors = shuffledColors(() => 0.37);
  assert.equal(colors.length, 25);
  assert.deepEqual([...new Set(colors)].sort(), ["blue", "lilac", "mint", "peach", "yellow"]);
  for (const color of new Set(colors)) assert.equal(colors.filter((item) => item === color).length, 5);
  assert.notDeepEqual(colors, shuffledColors(() => 0.73));
});

test("circular board gives every number one finite segment", () => {
  const board = Array.from({ length: 25 }, (_, index) => index + 1);
  const segments = circularSegments(board);
  assert.equal(segments.length, 25);
  assert.deepEqual(segments.map(({ number }) => number), board);
  for (const segment of segments) {
    assert.match(segment.path, /^M .* Z$/);
    assert.ok(!segment.path.includes("NaN"));
    assert.ok(Number.isFinite(segment.x) && Number.isFinite(segment.y));
  }
});
