import { useState } from "react";
import type { Task } from "../tasks/mockTasks";
import { compareBySchedule, formatDue, parseDue, priorityScore } from "../tasks/mockTasks";
import type { Capture } from "../../App";
import { Icon } from "../../shared/Icon";
import { fill, t, uiLocale } from "../../shared/i18n.ts";
import { VoiceAssistant, type GuestQuota } from "../tasks/VoiceAssistant";
import { MeditationCard } from "./MeditationCard";
import "./TodayPage.css";

type Props = {
  tasks: Task[];
  history: Capture[];
  navigate: (page: "tasks" | "training", day?: string) => void;
  voiceOpen: boolean;
  voiceText: string;
  openVoice: () => void;
  openTextChat: (text: string) => void;
  closeVoice: () => void;
  onSessionExpired: () => void;
  onTasksChanged: () => void;
  onTaskCompleted: (taskId: string) => void;
  guestQuota?: GuestQuota;
};

export function TodayPage({ tasks, history, navigate, voiceOpen, voiceText, openVoice, openTextChat, closeVoice, onSessionExpired, onTasksChanged, onTaskCompleted, guestQuota }: Props) {
  const [thought, setThought] = useState("");
  const open = tasks.filter((task) => !task.done);
  const next = [...open].sort(compareBySchedule)[0];
  const hour = new Date().getHours();
  const greeting = hour < 11 ? t("goodMorning") : hour < 18 ? t("goodAfternoon") : t("goodEvening");
  const date = new Intl.DateTimeFormat(uiLocale(), { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return <div className="today-page">
    <header className="today-intro"><span>{date}</span><h1>{greeting}，<br />{t("todayHeading")}</h1></header>
    <section className={`assistant-panel ${voiceOpen ? "voice-active" : ""}`} aria-labelledby="capture-title">
      <span className="demo-pill">{t("assistantPill")}</span>
      <VoiceAssistant expanded={voiceOpen} initialText={voiceText} guestQuota={guestQuota} onOpen={openVoice} onClose={closeVoice} onSessionExpired={onSessionExpired} onTasksChanged={onTasksChanged} onTaskCompleted={onTaskCompleted} />
      {!voiceOpen && <form className="quick-capture" onSubmit={(event) => { event.preventDefault(); if (thought.trim()) { openTextChat(thought.trim()); setThought(""); } }}>
        <label className="sr-only" htmlFor="quick-thought">{t("sendAria")}</label>
        <input id="quick-thought" maxLength={8000} value={thought} onChange={(event) => setThought(event.target.value)} placeholder={t("quickPlaceholder")} />
        <button type="submit" disabled={!thought.trim()} aria-label={t("sendAria")}><Icon name="arrow" size={19} /></button>
      </form>}
    </section>
    <div className="home-shortcuts">
      <button className="next-task" onClick={() => navigate("tasks", next ? parseDue(next.due).date : undefined)}><span className="shortcut-label">{t("nextTaskLabel")}</span><strong>{next?.title || t("noTasksYet")}</strong><span>{next ? `${t("priorityLabel")} ${priorityScore(next).toFixed(1)} · ${formatDue(next.due)}` : t("addFirstHint")}</span><Icon name="arrow" size={18} /></button>
      <button className="training-shortcut" onClick={() => navigate("training")}><Icon name="focus" size={24} /><strong>{t("trainingShortcut")}</strong><span>{t("countTo25")}</span><Icon name="arrow" size={18} /></button>
    </div>
    <MeditationCard />
    <details className="history-panel"><summary>{t("localHistory")} <span>{history.length ? fill("recordsCount", { n: history.length }) : t("noneYet")}</span></summary>{history.length ? <ol>{history.map((entry) => <li key={entry.id}><span>{new Intl.DateTimeFormat(uiLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.time))}</span><strong>{entry.title}</strong><small>{entry.edited ? t("editedLabel") : entry.input}</small></li>)}</ol> : <p>{t("noLocalRecords")}</p>}</details>
  </div>;
}
