import { api, post } from "../../shared/api.ts";
import { getLang, t } from "../../shared/i18n.ts";

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
export type Run = { status: "queued" | "running" | "completed" | "failed" | "cancelled"; phase?: string; assistant_content: string | null; error_code: string | null };
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
// Keep date parsing context and UI language explicit until runs have separate metadata fields.
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
export type RunEventHandlers = { onPhase: (phase: string) => void; onText: (text: string) => void };
export function streamRun(runId: string, handlers: RunEventHandlers, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      source.close();
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const read = (event: MessageEvent<string>) => {
      try { return JSON.parse(event.data) as Record<string, unknown>; }
      catch { return {}; }
    };
    const status = (event: Event) => {
      const payload = read(event as MessageEvent<string>);
      if (typeof payload.phase === "string") handlers.onPhase(payload.phase);
    };
    source.addEventListener("run.started", status);
    source.addEventListener("run.status", status);
    source.addEventListener("message.delta", (event) => {
      const payload = read(event as MessageEvent<string>);
      if (typeof payload.text === "string") handlers.onText(payload.text);
    });
    source.addEventListener("run.snapshot", (event) => {
      const payload = read(event as MessageEvent<string>);
      if (typeof payload.phase === "string") handlers.onPhase(payload.phase);
      if (["completed", "failed", "cancelled"].includes(String(payload.status))) finish();
    });
    source.addEventListener("run.completed", () => finish());
    source.addEventListener("run.failed", () => finish());
    source.addEventListener("run.cancelled", () => finish());
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) finish(new Error("SSE_UNAVAILABLE"));
    };
    const timeout = window.setTimeout(() => finish(new Error("SSE_TIMEOUT")), 185_000);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
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
