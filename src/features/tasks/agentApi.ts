import { api, post } from "../../shared/api.ts";
import { fill, getLang, t } from "../../shared/i18n.ts";

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
export type ProposalBatch = {
  batch_id: string; run_id: string; status: "pending" | "confirmed" | "cancelled" | "expired";
  proposals: Proposal[]; expires_at: string; created_at: string;
};
export type TaskDraft = Pick<ServerTask, "title" | "description" | "category" | "due" | "importance" | "urgency">;
export type Run = {
  run_id: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string; assistant_content: string | null; error_code: string | null; last_event_sequence: number;
};
export function runProgressMessage(phase: string, itemCount?: number): string {
  if (phase === "organizing_request") return t("runOrganizing");
  if (phase === "checking_tasks") return t("runCheckingTasks");
  if (phase === "preparing_drafts") return fill("runPreparingDrafts", { n: itemCount || 1 });
  if (phase === "drafts_ready") return t("runDraftsReady");
  return "";
}
export type SpeechDraft = { draft_text: string; needs_clarification: boolean; clarification: string | null; fallback_suggested?: boolean };
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
export const enhanceTranscription = (audio: Blob, token: string) => {
  const query = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, reason: "user_retry" });
  return api<SpeechDraft>(`/transcriptions/audio?${query}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "X-CSRF-Token": token, "X-Audio-Consent": "true" },
    body: audio,
  });
};
export const transcribeAudio = enhanceTranscription;
export const createConversation = (token: string, requestId: string) => post<{ conversation_id: string }>("/conversations", { client_request_id: requestId, title: t("voiceChatTitle") }, token);
// Keep local time and UI language in the saved message until runs have context metadata.
export function withLocalContext(text: string, language: "zh" | "en" = getLang()): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const localTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const context = `[应用提供的用户本地时间：${localTime}；时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}；APP_CONTEXT ui_language=${language}]\n`;
  return context.length + text.length <= 8000 ? context + text : text;
}
export const sendMessage = (conversationId: string, text: string, messageId: string, token: string) => post<{ run_id: string }>(`/conversations/${conversationId}/messages`, { client_message_id: messageId, content: text }, token);
export const getRun = (runId: string) => api<Run>(`/runs/${runId}`);
export const getRunProposals = (runId: string) => api<Proposal[]>(`/runs/${runId}/proposals`);
export const getRunProposalBatches = (runId: string) => api<ProposalBatch[]>(`/runs/${runId}/proposal-batches`);
export const getProposalBatch = (batchId: string) => api<ProposalBatch>(`/proposal-batches/${batchId}`);
export const updateProposalBatchItem = (batchId: string, proposalId: string, task: TaskDraft, token: string) => api<ProposalBatch>(`/proposal-batches/${batchId}/items/${proposalId}`, {
  method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify(task),
});
export const cancelProposalBatchItem = (batchId: string, proposalId: string, token: string) => post<ProposalBatch>(`/proposal-batches/${batchId}/items/${proposalId}/cancel`, {}, token);
export const confirmProposalBatch = (batchId: string, key: string, token: string) => post<{ batch_id: string; status: "confirmed"; confirmed_count: number; tasks: ServerTask[] }>(`/proposal-batches/${batchId}/confirm`, { idempotency_key: key }, token);
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
