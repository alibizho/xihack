import { getRoundInsight, type CompletedRound } from "../src/features/training/trainingInsight.ts";

const SYSTEM_PROMPT = `你是 5×5 数字寻找训练的单局复盘助手。你的价值是把这一局最突出的一个客观变化，转成用户下一局能尝试的一个动作。输入中的 focus 已由程序根据点击时间选定，围绕它写，不要罗列所有指标。
只返回 JSON 对象，恰好包含 observation 和 suggestion 两个字符串。
observation：20—55 个汉字。说明这一处数据与本局其他步骤或前后段相比意味着什么；只描述这一局，不猜测卡顿原因，不把一次训练概括为能力水平。
suggestion：15—40 个汉字。给一个与 focus 对应、能在下一局实际执行的找数动作；不要同时给多个建议，也不要重复 observation。
不要写“下次试试”“保持当前节奏”“继续加油”“注意力很好”等套话。不要诊断、评价健康或人格，不保证训练效果，不编造输入以外的数字。
focus 为 pause 时，建议遇到卡住的数字时采用有顺序的扫视；late 时，建议后段仍按固定顺序扫视；warmup 时，建议开局先扫一眼数字分布；accuracy 时，建议点击前确认当前目标数字；steady 时，建议用相同难度再做一局并只观察一个可比较指标。`;

export function trainingReviewRequest(round: CompletedRound) {
  const insight = getRoundInsight(round);
  return {
    model: "mimo-v2.6-flash",
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    max_completion_tokens: 300,
    temperature: 0.3,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ focus: insight.focus, evidence: insight.evidence, metrics: insight.metrics }) },
    ],
  };
}
