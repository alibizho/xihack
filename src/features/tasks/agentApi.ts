import { api, post } from "../../shared/api.ts";

export type Due = { precision: "date"; date: string; timezone: string } | { precision: "minute"; at: string; timezone: string } | null;
export type ServerTask = {
  task_id: string; title: string; description: string | null; category: string | null;
  due: Due; importance: number; urgency: number; status: "open" | "completed"; version: number;
};
export type Proposal = {
  proposal_id: string; operation: "create" | "update" | "complete" | "delete";
  task_id: string | null; task: Partial<ServerTask> | null; changes: Partial<ServerTask> | null;
  status: "pending" | "confirmed" | "cancelled" | "invalidated"; expires_at: string;
};
export type Run = { status: "queued" | "running" | "completed" | "failed" | "cancelled"; assistant_content: string | null; error_code: string | null };
export type SpeechDraft = { draft_text: string; needs_clarification: boolean; clarification: string | null };
export type TaskReport = {
  report_id: string; task_id: string; body: string; summary: string | null; blocker: string | null;
  next_step: string | null; status: "pending" | "analyzed" | "unavailable"; created_at: string;
};

export async function csrf() {
  return (await api<{ csrf_token: string }>("/auth/csrf")).csrf_token;
}

export async function listTasks(): Promise<ServerTask[]> {
  const tasks: ServerTask[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page: { items: ServerTask[]; next_cursor: string | null } = await api(`/tasks?${query}`);
    tasks.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return tasks;
}

export const calibrate = async (text: string, token: string) => post<SpeechDraft>("/transcriptions", { text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, token);
export const createConversation = (token: string, requestId: string) => post<{ conversation_id: string }>("/conversations", { client_request_id: requestId, title: "语音对话" }, token);
// ponytail: keep local time in the saved message until runs have separate context metadata.
export function withLocalContext(text: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const localTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const context = `[应用提供的用户本地时间：${localTime}；时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}]\n`;
  return context.length + text.length <= 8000 ? context + text : text;
}
export const sendMessage = (conversationId: string, text: string, messageId: string, token: string) => post<{ run_id: string }>(`/conversations/${conversationId}/messages`, { client_message_id: messageId, content: text }, token);
export const getRun = (runId: string) => api<Run>(`/runs/${runId}`);
export const getRunProposals = (runId: string) => api<Proposal[]>(`/runs/${runId}/proposals`);
export const confirmProposal = (id: string, key: string, token: string) => post(`/proposals/${id}/confirm`, { idempotency_key: key }, token);
export const cancelProposal = (id: string, token: string) => post(`/proposals/${id}/cancel`, {}, token);
export const proposeComplete = (task: ServerTask, token: string) => post<Proposal>("/proposals", {
  client_request_id: crypto.randomUUID(), operation: "complete", task_id: task.task_id, expected_version: task.version,
}, token);
export const proposeCreate = (task: object, token: string) => post<Proposal>("/proposals", {
  client_request_id: crypto.randomUUID(), operation: "create", task,
}, token);
export const proposeUpdate = (task: ServerTask, changes: object, token: string) => post<Proposal>("/proposals", {
  client_request_id: crypto.randomUUID(), operation: "update", task_id: task.task_id, expected_version: task.version, changes,
}, token);
export const getTaskReport = (taskId: string) => api<TaskReport>(`/tasks/${encodeURIComponent(taskId)}/report`);
export const submitTaskReport = (taskId: string, body: string, token: string) => post<TaskReport>(`/tasks/${encodeURIComponent(taskId)}/report`, { body }, token);
