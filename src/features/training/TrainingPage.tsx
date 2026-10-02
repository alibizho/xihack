import { useEffect, useRef, useState } from "react";
import { priorityScore, type Task } from "../tasks/mockTasks";
import { cellFeedback, shuffledBoard, type Difficulty } from "./trainingGame";
import { requestTrainingFeedback, type TrainingFeedback } from "./trainingFeedback";
import { Icon } from "../../shared/Icon";
import "./TrainingPage.css";

type Round = { id: string; difficulty: Difficulty; seconds: number; mistakes: number; taps: number[]; completedAt: string; feedback?: TrainingFeedback };
const modes: { id: Difficulty; name: string; detail: string }[] = [
  { id: "beginner", name: "入门", detail: "提示下一个数字，点过的格子变色" },
  { id: "normal", name: "普通", detail: "没有数字提示，点过的格子变色" },
  { id: "advanced", name: "进阶", detail: "没有提示，点过的格子保持原样" },
];
const formatTime = (seconds: number) => seconds.toFixed(1) + " 秒";

export function TrainingPage({ tasks, navigate }: { tasks: Task[]; navigate: () => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [phase, setPhase] = useState<"idle" | "countdown" | "playing" | "finished" | "interrupted">("idle");
  const [board, setBoard] = useState<number[]>(() => shuffledBoard());
  const [countdown, setCountdown] = useState(3);
  const [target, setTarget] = useState(1);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [taps, setTaps] = useState<number[]>([]);
  const [rounds, setRounds] = useState<Round[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("xihack-demo-rounds") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const [feedbackState, setFeedbackState] = useState<{ roundId: string; status: "loading" | "error"; message?: string } | null>(null);
  const startAt = useRef(0);
  const completed = useRef(false);
  const boardWrap = useRef<HTMLDivElement>(null);
  const resultWrap = useRef<HTMLElement>(null);
  const nextTask = [...tasks].filter((task) => !task.done).sort((a, b) => priorityScore(b) - priorityScore(a))[0];

  useEffect(() => { localStorage.setItem("xihack-demo-rounds", JSON.stringify(rounds)); }, [rounds]);
  useEffect(() => {
    if (phase !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else { startAt.current = performance.now(); setElapsed(0); setPhase("playing"); }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown]);
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => setElapsed((performance.now() - startAt.current) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (phase === "playing") boardWrap.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [phase]);
  useEffect(() => {
    if (phase === "finished") resultWrap.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [phase]);
  useEffect(() => {
    if (phase !== "playing" && phase !== "countdown") return;
    const interrupt = () => { if (document.hidden) setPhase("interrupted"); };
    document.addEventListener("visibilitychange", interrupt);
    return () => document.removeEventListener("visibilitychange", interrupt);
  }, [phase]);

  function start() {
    completed.current = false;
    setBoard(shuffledBoard());
    setTarget(1);
    setMistakes(0);
    setTaps([]);
    setElapsed(0);
    setCountdown(3);
    setPhase("countdown");
  }
  async function analyze(round: Round) {
    setFeedbackState({ roundId: round.id, status: "loading" });
    try {
      const feedback = await requestTrainingFeedback(round);
      try {
        const saved = JSON.parse(localStorage.getItem("xihack-demo-rounds") || "[]") as Round[];
        if (Array.isArray(saved)) localStorage.setItem("xihack-demo-rounds", JSON.stringify(saved.map((item) => item.id === round.id ? { ...item, feedback } : item)));
      } catch { /* Current result remains visible even if browser storage is unavailable. */ }
      setRounds((current) => current.map((item) => item.id === round.id ? { ...item, feedback } : item));
      setFeedbackState((current) => current?.roundId === round.id ? null : current);
    } catch (error) {
      const message = error instanceof Error && error.name !== "TimeoutError" ? error.message : "AI 响应超时，请稍后重试";
      setFeedbackState((current) => current?.roundId === round.id ? { roundId: round.id, status: "error", message } : current);
    }
  }
  function tap(number: number) {
    if (phase !== "playing" || completed.current) return;
    if (number !== target) { setMistakes((value) => value + 1); return; }
    const seconds = (performance.now() - startAt.current) / 1000;
    const nextTaps = [...taps, seconds];
    setTaps(nextTaps);
    setElapsed(seconds);
    if (target === 25) {
      completed.current = true;
      const round = { id: crypto.randomUUID(), difficulty, seconds, mistakes, taps: nextTaps, completedAt: new Date().toISOString() };
      setRounds((current) => [round, ...current].slice(0, 20));
      setPhase("finished");
      void analyze(round);
    } else setTarget(target + 1);
  }
  const last = rounds[0];
  const intervals = last?.taps.map((time, index) => time - (last.taps[index - 1] || 0)) || [];
  const slowest = intervals.length ? intervals.indexOf(Math.max(...intervals)) + 1 : 0;

  return <div className="training-page">
    <header className="training-intro"><span className="section-kicker">专注训练 / 5 × 5</span><h1>从 1 数到 25</h1><p>选一个难度，按顺序点击数字。</p></header>
    <div className="difficulty-picker" role="group" aria-label="训练难度">{modes.map((mode) => <button key={mode.id} className={difficulty === mode.id ? "selected" : ""} aria-pressed={difficulty === mode.id} disabled={phase === "playing" || phase === "countdown"} onClick={() => setDifficulty(mode.id)}><strong>{mode.name}</strong><span>{mode.detail}</span></button>)}</div>
    <section className="training-surface" aria-label="5×5 数字训练">
      <div className="training-bar"><span>{phase === "playing" && difficulty === "beginner" ? `下一个：${target}` : phase === "playing" ? `已完成 ${target - 1} / 25` : modes.find((mode) => mode.id === difficulty)?.name}</span><strong>{formatTime(elapsed)}</strong></div>
      {phase !== "idle" && <div className="board-wrap" ref={boardWrap}>
        <div className={`training-board ${phase === "countdown" ? "is-hidden" : ""}`}>{board.map((number) => <button key={number} className={`training-cell ${phase === "playing" ? cellFeedback(difficulty, number, target) : ""}`} onClick={() => tap(number)} disabled={phase !== "playing"} aria-label={`数字 ${number}`}>{number}</button>)}</div>
        {phase === "countdown" && <div className="board-overlay" aria-live="polite">{countdown}</div>}
      </div>}
      {phase === "playing" && <p className="training-progress">误触 {mistakes} 次 · 只有点对当前数字才会前进</p>}
      {(phase === "idle" || phase === "interrupted" || phase === "finished") && <button className="button button-primary training-start" onClick={start}><Icon name="play" size={18} /> {phase === "idle" ? "开始训练" : "再来一局"}</button>}
      {phase === "interrupted" && <p className="training-message">页面切到后台，本局已中断，不计入成绩。</p>}
    </section>
    {phase === "finished" && last && <section className="training-result" ref={resultWrap} aria-live="polite">
      <span className="section-kicker">本局结果 · {modes.find((mode) => mode.id === last.difficulty)?.name}</span>
      <h2>{formatTime(last.seconds)}</h2>
      <p>误触 {last.mistakes} 次 · 最慢的一步：{slowest === 1 ? "寻找 1" : `${slowest - 1} → ${slowest}`}</p>
      <div className="training-feedback">
        <h3>AI 本局复盘</h3>
        {last.feedback ? <><p>{last.feedback.observation}</p><p className="training-feedback-suggestion">下次试试：{last.feedback.suggestion}</p></>
          : feedbackState?.roundId === last.id && feedbackState.status === "loading" ? <p role="status">正在根据本局记录生成复盘…可以先浏览其他页面，成绩会保留。</p>
          : <div className="training-feedback-error"><p>{feedbackState?.roundId === last.id ? feedbackState.message : "本局复盘尚未生成"}</p><button type="button" onClick={() => void analyze(last)}>重试生成</button></div>}
        <small>仅将本局汇总指标发送给 MiMo，不上传任务或音视频。</small>
      </div>
      {nextTask && <button onClick={navigate}>接下来：{nextTask.title} <Icon name="arrow" size={17} /></button>}
    </section>}
    {rounds.length > 0 && <details className="round-history"><summary>训练记录 <span>{rounds.length} 局</span></summary><ol>{rounds.map((round) => <li key={round.id}><span>{modes.find((mode) => mode.id === round.difficulty)?.name}</span><strong>{formatTime(round.seconds)}</strong><small>误触 {round.mistakes} 次</small></li>)}</ol></details>}
  </div>;
}
