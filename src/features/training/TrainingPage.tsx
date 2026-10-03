import { useEffect, useRef, useState } from "react";
import { priorityScore, type Task } from "../tasks/mockTasks";
import { cellFeedback, shuffledBoard, type Difficulty } from "./trainingGame";
import { requestTrainingFeedback, type TrainingFeedback } from "./trainingFeedback";
import { getRoundInsight } from "./trainingInsight";
import { Icon } from "../../shared/Icon";
import { fill, t, uiLocale } from "../../shared/i18n.ts";
import "./TrainingPage.css";

type Round = { id: string; difficulty: Difficulty; seconds: number; mistakes: number; taps: number[]; completedAt: string; feedback?: TrainingFeedback };
const modes: { id: Difficulty; name: () => string; detail: () => string }[] = [
  { id: "beginner", name: () => t("modeBeginner"), detail: () => t("modeBeginnerDetail") },
  { id: "normal", name: () => t("modeNormal"), detail: () => t("modeNormalDetail") },
  { id: "advanced", name: () => t("modeAdvanced"), detail: () => t("modeAdvancedDetail") },
];
const formatTime = (seconds: number) => seconds.toFixed(1) + t("secondShort");
const pendingReviews = new Set<string>();
const roundsStorageKey = "xihack-demo-rounds";
const roundsUpdatedEvent = "xihack-rounds-updated";
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("trainingHistory") : new Intl.DateTimeFormat(uiLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

function RoundFeedback({ round }: { round: Round & { feedback: TrainingFeedback } }) {
  const insight = getRoundInsight(round, uiLocale() === "en-US" ? "en" : "zh");
  return <div className="round-feedback-content">
    <strong className="round-feedback-heading">{insight.heading}</strong>
    <p className="round-feedback-evidence">{insight.evidence}</p>
    <p className="round-feedback-observation">{round.feedback.observation}</p>
    <div className="round-feedback-action"><span>{t("reviewAction")}</span><p>{round.feedback.suggestion}</p></div>
  </div>;
}

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
      const saved = JSON.parse(localStorage.getItem(roundsStorageKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const [feedbackState, setFeedbackState] = useState<{ roundId: string; status: "loading" | "error"; message?: string } | null>(null);
  const startAt = useRef(0);
  const completed = useRef(false);
  const mounted = useRef(false);
  const boardWrap = useRef<HTMLDivElement>(null);
  const resultWrap = useRef<HTMLElement>(null);
  const nextTask = [...tasks].filter((task) => !task.done).sort((a, b) => priorityScore(b) - priorityScore(a))[0];

  useEffect(() => {
    const sync = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(roundsStorageKey) || "[]") as Round[];
        if (Array.isArray(saved)) setRounds((current) => {
          const storedIds = new Set(saved.map((item) => item.id));
          return [...current.filter((item) => !storedIds.has(item.id)), ...saved].slice(0, 20);
        });
      } catch { /* Keep the current records when storage is unavailable. */ }
    };
    window.addEventListener(roundsUpdatedEvent, sync);
    sync();
    return () => window.removeEventListener(roundsUpdatedEvent, sync);
  }, []);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    try { localStorage.setItem(roundsStorageKey, JSON.stringify(rounds)); }
    catch { /* Training still works when browser storage is unavailable. */ }
  }, [rounds]);
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
    if (pendingReviews.has(round.id)) return;
    pendingReviews.add(round.id);
    setFeedbackState({ roundId: round.id, status: "loading" });
    try {
      const feedback = await requestTrainingFeedback(round);
      try {
        const saved = JSON.parse(localStorage.getItem(roundsStorageKey) || "[]") as Round[];
        if (Array.isArray(saved)) {
          const updated = { ...round, feedback };
          const next = saved.some((item) => item.id === round.id)
            ? saved.map((item) => item.id === round.id ? updated : item)
            : [updated, ...saved].slice(0, 20);
          localStorage.setItem(roundsStorageKey, JSON.stringify(next));
        }
      } catch { /* Current result remains visible even if browser storage is unavailable. */ }
      setRounds((current) => current.map((item) => item.id === round.id ? { ...item, feedback } : item));
      setFeedbackState((current) => current?.roundId === round.id ? null : current);
    } catch (error) {
      const message = error instanceof Error && error.name !== "TimeoutError" ? error.message : t("reviewTimeout");
      setFeedbackState((current) => current?.roundId === round.id ? { roundId: round.id, status: "error", message } : current);
    } finally {
      pendingReviews.delete(round.id);
      window.dispatchEvent(new Event(roundsUpdatedEvent));
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
    <header className="training-intro"><span className="section-kicker">{t("trainingKicker")}</span><h1>{t("countFrom1to25")}</h1><p>{t("pickDifficulty")}</p></header>
    <div className="difficulty-picker" role="group" aria-label={t("difficultyAria")}>{modes.map((mode) => <button key={mode.id} className={difficulty === mode.id ? "selected" : ""} aria-pressed={difficulty === mode.id} disabled={phase === "playing" || phase === "countdown"} onClick={() => setDifficulty(mode.id)}><strong>{mode.name()}</strong><span>{mode.detail()}</span></button>)}</div>
    <section className="training-surface" aria-label={t("boardAria")}>
      <div className="training-bar"><span>{phase === "playing" && difficulty === "beginner" ? fill("nextNumber", { n: target }) : phase === "playing" ? fill("doneCount", { n: target - 1 }) : modes.find((mode) => mode.id === difficulty)?.name()}</span><strong>{formatTime(elapsed)}</strong></div>
      {phase !== "idle" && <div className="board-wrap" ref={boardWrap}>
        <div className={`training-board ${phase === "countdown" ? "is-hidden" : ""}`}>{board.map((number) => <button key={number} className={`training-cell ${phase === "playing" ? cellFeedback(difficulty, number, target) : ""}`} onClick={() => tap(number)} disabled={phase !== "playing"} aria-label={fill("numberAria", { n: number })}>{number}</button>)}</div>
        {phase === "countdown" && <div className="board-overlay" aria-live="polite">{countdown}</div>}
      </div>}
      {phase === "playing" && <p className="training-progress">{fill("mistakesNote", { n: mistakes })}</p>}
      {(phase === "idle" || phase === "interrupted" || phase === "finished") && <button className="button button-primary training-start" onClick={start}><Icon name="play" size={18} /> {phase === "idle" ? t("startTraining") : t("playAgain")}</button>}
      {phase === "interrupted" && <p className="training-message">{t("interruptedNote")}</p>}
    </section>
    {phase === "finished" && last && <section className="training-result" ref={resultWrap} aria-live="polite">
      <span className="section-kicker">{t("roundResult")} · {modes.find((mode) => mode.id === last.difficulty)?.name()}</span>
      <h2>{formatTime(last.seconds)}</h2>
      <p>{fill("mistakesSlowest", { n: last.mistakes, step: slowest === 1 ? t("findingFirst") : fill("nextStepAria", { a: slowest - 1, b: slowest }) })}</p>
      <div className="training-feedback">
        <div className="training-feedback-title"><h3>{t("reviewFocus")}</h3><span>{t("reviewProvider")}</span></div>
        {last.feedback ? <RoundFeedback round={{ ...last, feedback: last.feedback }} />
          : feedbackState?.roundId === last.id && feedbackState.status === "loading" ? <p role="status">{t("reviewLoading")}</p>
          : <div className="training-feedback-error"><p>{feedbackState?.roundId === last.id ? feedbackState.message : t("reviewMissing")}</p><button type="button" onClick={() => void analyze(last)}>{t("reviewRetry")}</button></div>}
        <small>{t("reviewPrivacy")}</small>
      </div>
      {nextTask && <button onClick={navigate}>{t("nextUpLabel")}{nextTask.title} <Icon name="arrow" size={17} /></button>}
    </section>}
    {rounds.length > 0 && <section className="round-history" aria-label="训练记录">
      <div className="round-history-heading"><h2>{t("trainingHistory")}</h2><span>{fill("reviewsCount", { rounds: rounds.length, reviews: rounds.filter((round) => round.feedback).length })}</span></div>
      <ol>{rounds.map((round) => <li key={round.id}>
        {round.feedback ? <details className="round-history-item">
          <summary><span className="round-history-date">{formatDate(round.completedAt)}</span><span className="round-history-mode">{modes.find((mode) => mode.id === round.difficulty)?.name()}</span><strong>{formatTime(round.seconds)}</strong><span className="round-history-review">{t("reviewSee")}</span><Icon name="chevronDown" size={18} /></summary>
          <div className="round-history-detail"><p className="round-history-mistakes">{fill("mistakesCount", { n: round.mistakes })}</p><RoundFeedback round={{ ...round, feedback: round.feedback }} /></div>
        </details> : <div className="round-history-item round-history-plain">
          <div className="round-history-summary"><span className="round-history-date">{formatDate(round.completedAt)}</span><span className="round-history-mode">{modes.find((mode) => mode.id === round.difficulty)?.name()}</span><strong>{formatTime(round.seconds)}</strong><span className="round-history-mistakes">{fill("mistakesCount", { n: round.mistakes })}</span></div>
          <button type="button" disabled={feedbackState?.status === "loading" || pendingReviews.has(round.id)} onClick={() => void analyze(round)}>{pendingReviews.has(round.id) ? t("generating") : t("reviewGenerate")}</button>
          {feedbackState?.roundId === round.id && feedbackState.status === "error" && <p role="status" className="round-history-error">{feedbackState.message}</p>}
        </div>}
      </li>)}</ol>
    </section>}
  </div>;
}
