import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_AI_CALLS, guestCallsLeft, isGuest, spendGuestCall } from "./guest.ts";

const fakeStore = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
};

test("guest quota counts down, refuses at zero, and is per account", () => {
  const store = fakeStore();
  const guest = "guest_ab12cd34";
  assert.ok(isGuest(guest));
  assert.ok(!isGuest("alice"));
  assert.equal(guestCallsLeft(guest, store), GUEST_AI_CALLS);
  for (let i = 0; i < GUEST_AI_CALLS; i++) assert.equal(spendGuestCall(guest, store), true);
  assert.equal(guestCallsLeft(guest, store), 0);
  assert.equal(spendGuestCall(guest, store), false);
  assert.equal(guestCallsLeft(guest, store), 0); // never negative
  assert.equal(guestCallsLeft("alice", store), GUEST_AI_CALLS); // untouched counter
});

test("corrupted stored quota falls back to full allowance", () => {
  const store = fakeStore();
  store.setItem("xihack:guest-ai:guest_bad1", "not-a-number");
  assert.equal(guestCallsLeft("guest_bad1", store), GUEST_AI_CALLS);
});
