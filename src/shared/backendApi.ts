export type Account = { username: string };
export type BackendDue = { precision: "date"; date: string; timezone: string } | { precision: "minute"; at: string; timezone: string } | null;
export type BackendTask = {
  task_id: string;
  title: string;
  description: string | null;
  category: string | null;
  due: BackendDue;
  important: boolean;
  urgent: boolean;
  status: "open" | "completed";
  version: number;
  created_at: string;
  updated_at: string;
};
export type TaskInput = Pick<BackendTask, "title" | "description" | "category" | "due" | "important" | "urgent">;
export type TaskChanges = Partial<TaskInput>;
export type TaskProposal = { proposal_id: string; operation: "create" | "update" | "complete" | "delete"; task_id: string | null; task: TaskInput | null; changes: TaskChanges | null; status: string; expires_at: string };
export type Conversation = { conversation_id: string; title: string; created_at: string; updated_at: string };
export type ConversationMessage = { message_id: string; role: "user" | "assistant"; content: string; created_at: string };
export type ConversationDetail = Conversation & { messages: ConversationMessage[]; next_cursor: string | null };
export type AgentRun = { run_id: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; assistant_content: string | null; error_code: string | null };

export class BackendError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: "登录已失效，请重新登录。",
  AUTH_INVALID: "用户名或密码不正确。",
  ORIGIN_INVALID: "站点地址与后端配置不一致，请联系管理员。",
  CSRF_INVALID: "操作验证已失效，请重试。",
  VERSION_CONFLICT: "这件事务已在别处更新，请刷新后重试。",
  PROPOSAL_EXPIRED: "确认已过期，请重新发起操作。",
  BACKEND_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
};

async function request<T>(path: string, options: RequestInit = {}, withCsrf = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  if (withCsrf) {
    const token = await request<{ csrf_token: string }>("/api/auth/csrf");
    headers.set("X-CSRF-Token", token.csrf_token);
  }
  let response: Response;
  try { response = await fetch(path, { ...options, credentials: "include", headers }); }
  catch { throw new BackendError("无法连接服务器，请检查网络后重试。", "NETWORK_ERROR", 0); }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  if (!response.ok) {
    const code = body?.code || "REQUEST_FAILED";
    throw new BackendError(messages[code] || (response.status === 429 ? "请求太频繁，请稍后重试。" : "操作没有完成，请稍后重试。"), code, response.status);
  }
  return body as T;
}

export const getAccount = async () => (await request<{ user: Account }>("/api/auth/me")).user;
export const login = async (username: string, password: string) => (await request<{ user: Account }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) })).user;
export const register = async (username: string, password: string) => (await request<{ user: Account }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, adult_declared: true }) })).user;
export const logout = () => request<void>("/api/auth/logout", { method: "POST" }, true);

export async function listAllTasks(): Promise<BackendTask[]> {
  const items: BackendTask[] = [];
  let cursor: string | null = null;
  do {
    const path = new URL("/api/tasks", location.origin);
    path.searchParams.set("limit", "100");
    if (cursor) path.searchParams.set("cursor", cursor);
    const page: { items: BackendTask[]; next_cursor: string | null } = await request(`${path.pathname}${path.search}`);
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

export function proposeCreate(task: TaskInput) {
  return request<TaskProposal>("/api/proposals", { method: "POST", body: JSON.stringify({ client_request_id: crypto.randomUUID(), operation: "create", task }) }, true);
}
export function proposeUpdate(task: BackendTask, changes: TaskChanges) {
  return request<TaskProposal>("/api/proposals", { method: "POST", body: JSON.stringify({ client_request_id: crypto.randomUUID(), operation: "update", task_id: task.task_id, expected_version: task.version, changes }) }, true);
}
export function proposeComplete(task: BackendTask) {
  return request<TaskProposal>("/api/proposals", { method: "POST", body: JSON.stringify({ client_request_id: crypto.randomUUID(), operation: "complete", task_id: task.task_id, expected_version: task.version }) }, true);
}
export function confirmProposal(proposal: TaskProposal) {
  return request<{ task_id: string; task: BackendTask | null }>(`/api/proposals/${encodeURIComponent(proposal.proposal_id)}/confirm`, { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID() }) }, true);
}
export function cancelProposal(proposal: TaskProposal) {
  return request<void>(`/api/proposals/${encodeURIComponent(proposal.proposal_id)}/cancel`, { method: "POST" }, true);
}
export const getProposal = (id: string) => request<TaskProposal>(`/api/proposals/${encodeURIComponent(id)}`);
export type SpeechDraft = { draft_text: string; intent: "create" | "update" | "complete" | "delete" | "query" | "unclear"; due: BackendDue; needs_clarification: boolean; clarification: string | null; fallback_suggested: boolean };
export const calibrateSpeechDraft = (text: string) => request<SpeechDraft>("/api/transcriptions", { method: "POST", body: JSON.stringify({ text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }, true);
export const listConversations = async () => (await request<{ items: Conversation[] }>("/api/conversations?limit=100")).items;
export const createConversation = (title = "新对话") => request<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ client_request_id: crypto.randomUUID(), title }) }, true);
export const renameConversation = (id: string, title: string) => request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) }, true);
export const getConversation = (id: string) => request<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}?limit=100`);
export const listConversationProposalIds = async (id: string) => (await request<{ proposal_ids: string[] }>(`/api/conversations/${encodeURIComponent(id)}/proposal-ids`)).proposal_ids;
export const submitAgentMessage = (id: string, content: string) => request<{ run_id: string }>(`/api/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ client_message_id: crypto.randomUUID(), content }) }, true);
export const getAgentRun = (id: string) => request<AgentRun>(`/api/runs/${encodeURIComponent(id)}`);
