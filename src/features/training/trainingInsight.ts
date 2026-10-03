import type { Difficulty } from "./trainingGame";

export type CompletedRound = { difficulty: Difficulty; seconds: number; mistakes: number; taps: number[] };

export function summarizeRound(round: CompletedRound & { id: string; variant?: "grid" | "circle"; completedAt: string }) {
  const intervals = round.taps.map((time, index) => time - (round.taps[index - 1] || 0));
  const average = (items: number[]) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0.1;
  const hour = new Date(round.completedAt).getHours();
  const dayPeriod = hour >= 5 && hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
  return {
    client_round_id: round.id,
    day_period: dayPeriod,
    difficulty: round.difficulty,
    variant: round.variant || "grid",
    duration_seconds: Number(Math.max(0.1, round.seconds).toFixed(2)),
    mistakes: round.mistakes,
    average_step_seconds: Number(average(intervals).toFixed(3)),
    first_half_seconds: Number(average(intervals.slice(0, 12)).toFixed(3)),
    second_half_seconds: Number(average(intervals.slice(12)).toFixed(3)),
    max_pause_seconds: Number(Math.max(0.1, ...intervals).toFixed(3)),
    completed_at: round.completedAt,
  };
}

export function getRoundInsight(round: CompletedRound, language: "zh" | "en" = "zh") {
  const intervals = round.taps.map((time, index) => time - (round.taps[index - 1] || 0));
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = average(intervals.slice(0, 8));
  const middle = average(intervals.slice(8, 17));
  const last = average(intervals.slice(17));
  const overall = average(intervals);
  const slowestIndex = intervals.indexOf(Math.max(...intervals));
  const slowest = intervals[slowestIndex];
  const step = slowestIndex === 0 ? (language === "en" ? "finding 1" : "寻找 1") : language === "en" ? `${slowestIndex} to ${slowestIndex + 1}` : `${slowestIndex} → ${slowestIndex + 1}`;
  const seconds = (value: number) => language === "en" ? `${value.toFixed(1)} seconds` : `${value.toFixed(1)} 秒`;

  let focus: "pause" | "late" | "warmup" | "accuracy" | "steady";
  let heading: string;
  let evidence: string;
  if (slowest >= overall * 1.8 && slowest >= 1.2) {
    focus = "pause";
    heading = language === "en" ? `The step at ${step} took longer` : `${step} 这一跳花了更久`;
    evidence = language === "en" ? `This step took ${seconds(slowest)}; the average step took ${seconds(overall)}` : `这一步 ${seconds(slowest)}，单步平均 ${seconds(overall)}`;
  } else if (last >= first * 1.25 && last - first >= 0.25) {
    focus = "late";
    heading = language === "en" ? "Finding numbers took longer near the end" : "后段找数花了更久";
    evidence = language === "en" ? `The first 8 steps averaged ${seconds(first)}; the last 8 averaged ${seconds(last)}` : `前 8 步平均 ${seconds(first)}，后 8 步平均 ${seconds(last)}`;
  } else if (first >= last * 1.25 && first - last >= 0.25) {
    focus = "warmup";
    heading = language === "en" ? "Number finding got faster as the round went on" : "进入状态后，找数更快了";
    evidence = language === "en" ? `The first 8 steps averaged ${seconds(first)}; the last 8 averaged ${seconds(last)}` : `前 8 步平均 ${seconds(first)}，后 8 步平均 ${seconds(last)}`;
  } else if (round.mistakes > 0) {
    focus = "accuracy";
    heading = language === "en" ? `${round.mistakes} misclicks this round` : `这一局有 ${round.mistakes} 次误触`;
    evidence = language === "en" ? `Time: ${seconds(round.seconds)}; misclicks: ${round.mistakes}` : `用时 ${seconds(round.seconds)}，误触 ${round.mistakes} 次`;
  } else {
    focus = "steady";
    heading = language === "en" ? "The pace was similar across the round" : "前后段用时接近";
    evidence = language === "en" ? `The first 8 steps averaged ${seconds(first)}; the last 8 averaged ${seconds(last)}` : `前 8 步平均 ${seconds(first)}，后 8 步平均 ${seconds(last)}`;
  }

  return {
    focus, heading, evidence,
    metrics: {
      difficulty: language === "en"
        ? ({ beginner: "beginner", normal: "normal", advanced: "advanced" })[round.difficulty]
        : ({ beginner: "入门", normal: "普通", advanced: "进阶" })[round.difficulty],
      totalSeconds: Number(round.seconds.toFixed(1)),
      mistakes: round.mistakes,
      firstEightAverageSeconds: Number(first.toFixed(1)),
      middleNineAverageSeconds: Number(middle.toFixed(1)),
      lastEightAverageSeconds: Number(last.toFixed(1)),
      slowestStep: step,
      slowestStepSeconds: Number(slowest.toFixed(1)),
    },
  };
}
