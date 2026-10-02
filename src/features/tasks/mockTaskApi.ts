import { mockProposal, voiceExamples, type Task, type TaskDraft } from "./mockTasks.ts";

// Demo responses for POST /api/transcribe and POST /api/interpret.
// Replace these two functions when the backend endpoints are ready.
export async function transcribeTask(audio: Blob): Promise<{ text: string }> {
  if (!audio.size) throw new Error("没有录到声音，请再试一次");
  return { text: voiceExamples[0] };
}

export async function interpretTask(request: {
  text: string;
  now: string;
  timezone: string;
  tasks: Task[];
  history: { input: string; title: string }[];
}): Promise<TaskDraft> {
  return mockProposal(request.text, new Date(request.now));
}
