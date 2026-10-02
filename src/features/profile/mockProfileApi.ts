export type UserProfile = { id: string; username: string };

const key = "xihack-demo-profile";
const demoUser: UserProfile = { id: "demo-user", username: "演示用户" };

// Demo responses for GET, PATCH, and DELETE /api/profile.
// Replace these functions with endpoint calls when the account API is ready.
export async function getProfile(): Promise<UserProfile | null> {
  const saved = localStorage.getItem(key);
  if (saved === null) return demoUser;
  try {
    const profile = JSON.parse(saved);
    return profile?.id && profile?.username ? profile as UserProfile : null;
  } catch {
    return demoUser;
  }
}

export async function updateProfile(username: string): Promise<UserProfile> {
  const clean = username.trim();
  if (!clean) throw new Error("请输入用户名");
  const current = await getProfile();
  const profile = { id: current?.id ?? demoUser.id, username: clean };
  localStorage.setItem(key, JSON.stringify(profile));
  return profile;
}

export async function deleteProfile(): Promise<{ deleted: true }> {
  localStorage.setItem(key, "null");
  return { deleted: true };
}
