import assert from "node:assert/strict";
import test from "node:test";
import { RunEventCursor } from "./runEventCursor.ts";

test("run event cursor accepts each sequence once and rejects invalid ids", () => {
  const cursor = new RunEventCursor();
  assert.equal(cursor.accept("1"), true);
  assert.equal(cursor.accept("1"), false);
  assert.equal(cursor.accept("0"), false);
  assert.equal(cursor.accept("not-a-sequence"), false);
  assert.equal(cursor.accept("9007199254740992"), false);
  assert.equal(cursor.current, 1);
});

test("snapshot sequence advances the cursor past events represented by the snapshot", () => {
  const cursor = new RunEventCursor(2);
  cursor.advanceTo(8);
  cursor.advanceTo(7);
  assert.equal(cursor.current, 8);
  assert.equal(cursor.accept("8"), false);
  assert.equal(cursor.accept("9"), true);
});
