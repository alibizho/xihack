import assert from "node:assert/strict";
import test from "node:test";
import { fill, getLang, setLang, speechLang, t } from "./i18n.ts";

test("language switch swaps strings, templates, and speech locale", () => {
  setLang("zh");
  assert.equal(getLang(), "zh");
  assert.equal(t("navToday"), "今天");
  assert.equal(fill("guestNote", { n: 5 }).includes("5"), true);
  assert.equal(speechLang(), "zh-CN");
  setLang("en");
  assert.equal(t("navToday"), "Today");
  assert.equal(fill("doneCount", { n: 3 }), "3 / 25 done");
  assert.equal(speechLang(), "en-US");
  setLang("zh"); // restore for other tests
});
