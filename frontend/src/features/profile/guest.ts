import { register } from "./authApi.ts";

export const GUEST_AI_CALLS = 5;
// ponytail: guest = auto-registered ephemeral account; tasks live in Postgres like any user, session cookie is the only credential. Guest→real-account data migration is not built; register to start fresh.
export const isGuest = (username: string) => username.startsWith("guest_");

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const quotaKey = (username: string) => `xihack:guest-ai:${username}`;

// ponytail: quota enforced client-side only; the API has no per-account guest flag. Move server-side if guests farm accounts.
export function guestCallsLeft(username: string, store: Store = localStorage): number {
  const used = Number(store.getItem(quotaKey(username)) ?? 0);
  return Math.max(0, GUEST_AI_CALLS - (Number.isFinite(used) ? used : 0));
}

export function spendGuestCall(username: string, store: Store = localStorage): boolean {
  const left = guestCallsLeft(username, store);
  if (left <= 0) return false;
  store.setItem(quotaKey(username), String(GUEST_AI_CALLS - left + 1));
  return true;
}

export async function registerGuest(): Promise<string> {
  const username = `guest_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const password = crypto.randomUUID() + crypto.randomUUID(); // ponytail: guest never types it; lost session = new guest.
  const { user } = await register(username, password);
  return user.username;
}
