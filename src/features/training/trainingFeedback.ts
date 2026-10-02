import type { Difficulty } from "./trainingGame";

export type TrainingFeedback = { observation: string; suggestion: string };
export type FeedbackRound = { difficulty: Difficulty; seconds: number; mistakes: number; taps: number[] };

export async function requestTrainingFeedback(round: FeedbackRound): Promise<TrainingFeedback> {
  const response = await fetch("/api/training-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ difficulty: round.difficulty, seconds: round.seconds, mistakes: round.mistakes, taps: round.taps }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "AI 暂时无法生成复盘，本局成绩已保存";
    throw new Error(message);
  }
  if (!data || typeof data !== "object" || !("observation" in data) || !("suggestion" in data) || typeof data.observation !== "string" || typeof data.suggestion !== "string") {
    throw new Error("AI 返回内容不完整，请重试");
  }
  return { observation: data.observation, suggestion: data.suggestion };
}
