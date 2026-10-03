import { useEffect, useRef, useState } from "react";
import { priorityScore, type Task } from "../tasks/mockTasks";
import { cellFeedback, shuffledBoard, shuffledColors, type Difficulty } from "./trainingGame";
import { circularRingSizes, circularSegments, ringRotation } from "./circularBoard";
import { Icon } from "../../shared/Icon";
import { fill, t } from "../../shared/i18n.ts";
import "./TrainingPage.css";

type Variant = "grid" | "circle";
type Round = { id: string; difficulty: Difficulty; variant?: Variant; seconds: number; mistakes: number; taps: number[]; completedAt: string };
const variants: { id: Variant; name: () => string }[] = [
  { id: "grid", name: () => t("gridVariant") },
  { id: "circle", name: () => t("circleVariant") },
];
const variantName = (variant: Variant = "grid") => variants.find((item) => item.id === variant)?.name();
const modes: { id: Difficulty; name: () => string; detail: () => string }[] = [
  { id: "beginner", name: () => t("modeBeginner"), detail: () => t("modeBeginnerDetail") },
  { id: "normal", name: () => t("modeNormal"), detail: () => t("modeNormalDetail") },
  { id: "advanced", name: () => t("modeAdvanced"), detail: () => t("modeAdvancedDetail") },
];
const circleDetails: Record<Difficulty, () => string> = {
  beginner: () => t("circleBeginnerDetail"),
  normal: () => t("circleNormalDetail"),
  advanced: () => t("circleAdvancedDetail"),
};
const formatTime = (seconds: number) => seconds.toFixed(1) + t("secondShort");

export function TrainingPage({ tasks, navigate }: { tasks: Task[]; navigate: () => void }) {
  const [variant, setVariant] = useState<Variant>("grid");
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [phase, setPhase] = useState<"idle" | "countdown" | "playing" | "finished" | "interrupted">("idle");
  const [board, setBoard] = useState<number[]>(() => shuffledBoard());
  const [gridColors, setGridColors] = useState<string[]>(() => shuffledColors());
  const [circleTaps, setCircleTaps] = useState(0);
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
  const startAt = useRef(0);
  const boardWrap = useRef<HTMLDivElement>(null);
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
    if (phase !== "playing" && phase !== "countdown") return;
    const interrupt = () => { if (document.hidden) setPhase("interrupted"); };
    document.addEventListener("visibilitychange", interrupt);
    return () => document.removeEventListener("visibilitychange", interrupt);
  }, [phase]);

  function start() {
    setBoard(shuffledBoard());
    setGridColors(shuffledColors());
    setCircleTaps(0);
    setTarget(1);
    setMistakes(0);
    setTaps([]);
    setElapsed(0);
    setCountdown(3);
    setPhase("countdown");
  }
  function tap(number: number) {
    if (phase !== "playing") return;
    if (variant === "circle") setCircleTaps((value) => value + 1);
    if (number !== target) { setMistakes((value) => value + 1); return; }
    const seconds = (performance.now() - startAt.current) / 1000;
    const nextTaps = [...taps, seconds];
    setTaps(nextTaps);
    setElapsed(seconds);
    if (target === 25) {
      const round = { id: crypto.randomUUID(), difficulty, variant, seconds, mistakes, taps: nextTaps, completedAt: new Date().toISOString() };
      setRounds((current) => [round, ...current].slice(0, 20));
      setPhase("finished");
    } else setTarget(target + 1);
  }
  const last = rounds[0];
  const intervals = last?.taps.map((time, index) => time - (last.taps[index - 1] || 0)) || [];
  const slowest = intervals.length ? intervals.indexOf(Math.max(...intervals)) + 1 : 0;
  const circular = variant === "circle" ? circularSegments(board) : [];

  return <div className="training-page">
    <header className="training-intro"><span className="section-kicker">{t("trainingKicker")}</span><h1>{t("countFrom1to25")}</h1><p>{t("pickDifficulty")}</p></header>
    <div className="variant-picker" role="group" aria-label={t("variantAria")}>{variants.map((item) => <button key={item.id} className={variant === item.id ? "selected" : ""} aria-pressed={variant === item.id} disabled={phase === "playing" || phase === "countdown"} onClick={() => setVariant(item.id)}>{item.name()}</button>)}</div>
    <div className="difficulty-picker" role="group" aria-label={t("difficultyAria")}>{modes.map((mode) => <button key={mode.id} className={difficulty === mode.id ? "selected" : ""} aria-pressed={difficulty === mode.id} disabled={phase === "playing" || phase === "countdown"} onClick={() => setDifficulty(mode.id)}>{mode.name()}</button>)}</div>
    <p className="difficulty-detail" aria-live="polite">{variant === "circle" ? circleDetails[difficulty]() : modes.find((mode) => mode.id === difficulty)?.detail()}</p>
    <section className="training-surface" aria-label={variant === "circle" ? t("circleBoardAria") : t("boardAria")}>
      <div className="training-bar"><span>{phase === "playing" && difficulty === "beginner" ? fill("nextNumber", { n: target }) : phase === "playing" ? fill("doneCount", { n: target - 1 }) : modes.find((mode) => mode.id === difficulty)?.name()}</span><strong>{formatTime(elapsed)}</strong></div>
      {phase !== "idle" && <div className="board-wrap" ref={boardWrap}>
        {variant === "grid" ? <div className={`training-board ${phase === "countdown" ? "is-hidden" : ""}`}>{board.map((number, index) => <button key={number} className={`training-cell ${gridColors[index]} ${phase === "playing" ? cellFeedback(difficulty, number, target) : ""}`} onClick={() => tap(number)} disabled={phase !== "playing"} aria-label={fill("numberAria", { n: number })}>{number}</button>)}</div>
          : <svg className={`circular-board ${phase === "countdown" ? "is-hidden" : ""}`} viewBox="0 0 500 500" role="group" aria-label={t("circleBoardAria")}>
            {circularRingSizes.map((_, ring) => {
              const angle = ringRotation(difficulty, ring, circleTaps);
              return <g key={ring} className="circular-ring" style={{ transform: `rotate(${angle}deg)` }}>
                {circular.filter((segment) => segment.ring === ring).map(({ number, color, path, x, y }) => <g key={number} className={`circular-segment ${color} ${phase === "playing" ? cellFeedback(difficulty, number, target) : ""}`} role="button" tabIndex={phase === "playing" ? 0 : -1} aria-label={fill("numberAria", { n: number })} aria-disabled={phase !== "playing"} onClick={() => tap(number)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); tap(number); } }}><path d={path} /><text x={x} y={y} dominantBaseline="central" textAnchor="middle" style={{ transform: `rotate(${-angle}deg)` }}>{number}</text></g>)}
              </g>;
            })}
            <g aria-hidden="true"><circle className="circular-hub" cx="250" cy="250" r="34" /><path className="circular-crosshair" d="M 250 231 V 269 M 231 250 H 269" /><circle className="circular-dot" cx="250" cy="250" r="5" /></g>
          </svg>}
        {phase === "countdown" && <div className="board-overlay" aria-live="polite">{countdown}</div>}
      </div>}
      {phase === "playing" && <p className="training-progress">{fill("mistakesNote", { n: mistakes })}</p>}
      {(phase === "idle" || phase === "interrupted" || phase === "finished") && <button className="button button-primary training-start" onClick={start}><Icon name="play" size={18} /> {phase === "idle" ? t("startTraining") : t("playAgain")}</button>}
      {phase === "interrupted" && <p className="training-message">{t("interruptedNote")}</p>}
    </section>
    {phase === "finished" && last && <section className="training-result" aria-live="polite"><span className="section-kicker">{t("roundResult")} · {variantName(last.variant)} · {modes.find((mode) => mode.id === last.difficulty)?.name()}</span><h2>{formatTime(last.seconds)}</h2><p>{fill("mistakesSlowest", { n: last.mistakes, step: slowest === 1 ? t("findingFirst") : fill("nextStepAria", { a: slowest - 1, b: slowest }) })}</p>{nextTask && <button onClick={navigate}>{t("nextUpLabel")}{nextTask.title} <Icon name="arrow" size={17} /></button>}</section>}
    {rounds.length > 0 && <details className="round-history"><summary>{t("trainingHistory")} <span>{fill("roundsCount", { n: rounds.length })}</span></summary><ol>{rounds.map((round) => <li key={round.id}><span>{variantName(round.variant)} · {modes.find((mode) => mode.id === round.difficulty)?.name()}</span><strong>{formatTime(round.seconds)}</strong><small>{fill("mistakesCount", { n: round.mistakes })}</small></li>)}</ol></details>}
  </div>;
}
