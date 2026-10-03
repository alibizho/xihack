import { api, post } from "../../shared/api.ts";

type AuthResponse = { user: { username: string } };

export const currentUser = () => api<AuthResponse>("/auth/me");
export const login = (username: string, password: string) => post<AuthResponse>("/auth/login", { username, password });
export const register = (username: string, password: string) => post<AuthResponse>("/auth/register", { username, password, adult_declared: true });

export async function logout(): Promise<void> {
  const { csrf_token } = await api<{ csrf_token: string }>("/auth/csrf");
  await post<void>("/auth/logout", {}, csrf_token);
}
