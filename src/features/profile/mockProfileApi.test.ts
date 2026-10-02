import assert from "node:assert/strict";
import test from "node:test";
import { deleteProfile, getProfile, updateProfile } from "./mockProfileApi.ts";

test("demo profile can be renamed, deleted, and created again", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  assert.equal((await getProfile())?.username, "演示用户");
  assert.equal((await updateProfile("  小易  ")).username, "小易");
  assert.equal((await getProfile())?.username, "小易");
  assert.deepEqual(await deleteProfile(), { deleted: true });
  assert.equal(await getProfile(), null);
  assert.equal((await updateProfile("新用户")).username, "新用户");
});
