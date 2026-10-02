import { mockProposal, type Task, type TaskDraft } from "./mockTasks.ts";

// Demo response for task interpretation until backend task proposals are available.
export async function interpretTask(request: {
  text: string;
  now: string;
  timezone: string;
  tasks: Task[];
  history: { input: string; title: string }[];
}): Promise<TaskDraft> {
  return mockProposal(request.text, new Date(request.now));
}
